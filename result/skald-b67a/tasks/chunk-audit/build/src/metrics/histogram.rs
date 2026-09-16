//! Power-of-two bucket histogram — part of the `metrics` subsystem.
//!
//! Samples land in the bucket named by the position of their highest set bit,
//! so a histogram covering the whole 64-bit range costs 65 counters and never
//! reallocates. Zero has its own bucket. Quantiles are interpolated inside the
//! bucket they fall in, which is exact at the bucket edges and no worse than
//! a factor of two anywhere else.

/// One bucket's extent and occupancy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bucket {
    /// Smallest sample this bucket accepts.
    pub low: u64,
    /// Largest sample this bucket accepts.
    pub high: u64,
    /// How many samples landed here.
    pub count: u64,
}

const BUCKETS: usize = 65;

pub struct Histogram {
    buckets: [u64; BUCKETS],
    count: u64,
    sum: u128,
    min: u64,
    max: u64,
}

impl Default for Histogram {
    fn default() -> Histogram {
        Histogram::new()
    }
}

impl Histogram {
    pub fn new() -> Histogram {
        Histogram {
            buckets: [0; BUCKETS],
            count: 0,
            sum: 0,
            min: u64::MAX,
            max: 0,
        }
    }

    /// Which bucket a sample belongs to.
    pub fn bucket_index(sample: u64) -> usize {
        if sample == 0 {
            0
        } else {
            (64 - sample.leading_zeros()) as usize
        }
    }

    /// The extent of bucket `index`, or `None` past the last one.
    pub fn bucket_bounds(index: usize) -> Option<(u64, u64)> {
        if index >= BUCKETS {
            return None;
        }
        if index == 0 {
            return Some((0, 0));
        }
        let low = 1u64 << (index - 1);
        let high = if index == 64 {
            u64::MAX
        } else {
            (1u64 << index) - 1
        };
        Some((low, high))
    }

    pub fn record(&mut self, sample: u64) {
        let idx = Histogram::bucket_index(sample);
        self.buckets[idx] += 1;
        self.count += 1;
        self.sum += sample as u128;
        if sample < self.min {
            self.min = sample;
        }
        if sample > self.max {
            self.max = sample;
        }
    }

    /// Record the same sample `times` times.
    pub fn record_many(&mut self, sample: u64, times: u64) {
        if times == 0 {
            return;
        }
        let idx = Histogram::bucket_index(sample);
        self.buckets[idx] += times;
        self.count += times;
        self.sum += (sample as u128) * (times as u128);
        if sample < self.min {
            self.min = sample;
        }
        if sample > self.max {
            self.max = sample;
        }
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub fn sum(&self) -> u128 {
        self.sum
    }

    /// Smallest sample recorded, or `None` if nothing has been.
    pub fn min(&self) -> Option<u64> {
        if self.count == 0 {
            None
        } else {
            Some(self.min)
        }
    }

    /// Largest sample recorded, or `None` if nothing has been.
    pub fn max(&self) -> Option<u64> {
        if self.count == 0 {
            None
        } else {
            Some(self.max)
        }
    }

    /// Arithmetic mean of every sample, or `None` if nothing has been recorded.
    pub fn mean(&self) -> Option<f64> {
        if self.count == 0 {
            None
        } else {
            Some(self.sum as f64 / self.count as f64)
        }
    }

    /// Occupancy of one bucket.
    pub fn bucket_count(&self, index: usize) -> u64 {
        self.buckets.get(index).copied().unwrap_or(0)
    }

    /// Every bucket that holds at least one sample, in ascending order.
    pub fn occupied_buckets(&self) -> Vec<Bucket> {
        let mut out = Vec::new();
        for (i, &count) in self.buckets.iter().enumerate() {
            if count == 0 {
                continue;
            }
            let (low, high) = Histogram::bucket_bounds(i).unwrap();
            out.push(Bucket { low, high, count });
        }
        out
    }

    /// The sample at quantile `q`, clamped to `[0, 1]`.
    ///
    /// The answer is the interpolated position inside the bucket the rank
    /// falls in, held down to the largest sample actually recorded, so it
    /// always names a value inside the observed range.
    pub fn quantile(&self, q: f64) -> Option<u64> {
        if self.count == 0 {
            return None;
        }
        let q = if q < 0.0 {
            0.0
        } else if q > 1.0 {
            1.0
        } else {
            q
        };
        let rank = (q * self.count as f64).ceil().max(1.0) as u64;
        let mut seen = 0u64;
        for (i, &count) in self.buckets.iter().enumerate() {
            if count == 0 {
                continue;
            }
            if seen + count >= rank {
                let (low, high) = Histogram::bucket_bounds(i).unwrap();
                if low == high {
                    return Some(low);
                }
                let within = (rank - seen - 1) as f64 / count as f64;
                let span = (high - low) as f64;
                return Some((low + (within * span) as u64).min(self.max));
            }
            seen += count;
        }
        Some(self.max)
    }

    /// Median, by the same interpolation as [`Histogram::quantile`].
    pub fn median(&self) -> Option<u64> {
        self.quantile(0.5)
    }

    /// Fold another histogram's samples into this one.
    pub fn merge(&mut self, other: &Histogram) {
        if other.count == 0 {
            return;
        }
        for (i, &count) in other.buckets.iter().enumerate() {
            self.buckets[i] += count;
        }
        self.count += other.count;
        self.sum += other.sum;
        if other.min < self.min {
            self.min = other.min;
        }
        if other.max > self.max {
            self.max = other.max;
        }
    }

    /// Forget every sample.
    pub fn reset(&mut self) {
        self.buckets = [0; BUCKETS];
        self.count = 0;
        self.sum = 0;
        self.min = u64::MAX;
        self.max = 0;
    }

    /// One line per occupied bucket: `low..high count`.
    pub fn render(&self) -> String {
        let mut out = String::new();
        for b in self.occupied_buckets() {
            out.push_str(&format!("{}..{} {}\n", b.low, b.high, b.count));
        }
        out
    }
}
