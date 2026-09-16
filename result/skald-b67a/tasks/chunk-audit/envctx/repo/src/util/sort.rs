//! Sorting and searching routines over i64 slices — a faithful port of
//! `util/sort.c`.

pub fn is_sorted(a: &[i64]) -> bool {
    a.windows(2).all(|w| w[0] <= w[1])
}

pub fn insertion_sort(a: &mut [i64]) {
    for i in 1..a.len() {
        let key = a[i];
        let mut j = i;
        while j > 0 && a[j - 1] > key {
            a[j] = a[j - 1];
            j -= 1;
        }
        a[j] = key;
    }
}

fn partition(a: &mut [i64], lo: usize, hi: usize) -> usize {
    let pivot = a[hi];
    let mut i = lo;
    for j in lo..hi {
        if a[j] < pivot {
            a.swap(i, j);
            i += 1;
        }
    }
    a.swap(i, hi);
    i
}

fn quicksort_rec(a: &mut [i64], lo: usize, hi: usize) {
    if lo < hi {
        let p = partition(a, lo, hi);
        if p > 0 {
            quicksort_rec(a, lo, p - 1);
        }
        quicksort_rec(a, p + 1, hi);
    }
}

pub fn quicksort(a: &mut [i64]) {
    if a.len() > 1 {
        let hi = a.len() - 1;
        quicksort_rec(a, 0, hi);
    }
}

pub fn merge_sort(a: &mut [i64]) {
    let n = a.len();
    if n < 2 {
        return;
    }
    let mid = n / 2;
    let mut left = a[..mid].to_vec();
    let mut right = a[mid..].to_vec();
    merge_sort(&mut left);
    merge_sort(&mut right);
    let (mut i, mut j, mut k) = (0, 0, 0);
    while i < left.len() && j < right.len() {
        if left[i] <= right[j] {
            a[k] = left[i];
            i += 1;
        } else {
            a[k] = right[j];
            j += 1;
        }
        k += 1;
    }
    while i < left.len() {
        a[k] = left[i];
        i += 1;
        k += 1;
    }
    while j < right.len() {
        a[k] = right[j];
        j += 1;
        k += 1;
    }
}

fn heapify(a: &mut [i64], n: usize, i: usize) {
    let mut largest = i;
    let l = 2 * i + 1;
    let r = 2 * i + 2;
    if l < n && a[l] > a[largest] {
        largest = l;
    }
    if r < n && a[r] > a[largest] {
        largest = r;
    }
    if largest != i {
        a.swap(i, largest);
        heapify(a, n, largest);
    }
}

pub fn heap_sort(a: &mut [i64]) {
    let n = a.len();
    if n < 2 {
        return;
    }
    for i in (0..n / 2).rev() {
        heapify(a, n, i);
    }
    for i in (1..n).rev() {
        a.swap(0, i);
        heapify(a, i, 0);
    }
}

/// Binary search in a sorted slice; returns the index of `target` or None.
pub fn binary_search(a: &[i64], target: i64) -> Option<usize> {
    let mut lo = 0isize;
    let mut hi = a.len() as isize - 1;
    while lo <= hi {
        let mid = ((lo + hi) / 2) as usize;
        if a[mid] == target {
            return Some(mid);
        } else if a[mid] < target {
            lo = mid as isize + 1;
        } else {
            hi = mid as isize - 1;
        }
    }
    None
}

/// Lower bound: first index whose element is >= target.
pub fn lower_bound(a: &[i64], target: i64) -> usize {
    let mut lo = 0;
    let mut hi = a.len();
    while lo < hi {
        let mid = (lo + hi) / 2;
        if a[mid] < target {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}
