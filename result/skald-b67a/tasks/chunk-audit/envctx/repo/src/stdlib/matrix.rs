//! Dense f64 matrix operations — a faithful port of the matrix portion of
//! `lib/math_lib.c` (`mat_*`).
//!
//! Row-major dense matrices with the common linear-algebra operations used by
//! the scripting layer.

#[derive(Clone)]
pub struct Matrix {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<f64>,
}

impl Matrix {
    pub fn new(rows: usize, cols: usize) -> Matrix {
        Matrix {
            rows,
            cols,
            data: vec![0.0; rows * cols],
        }
    }

    pub fn identity(n: usize) -> Matrix {
        let mut m = Matrix::new(n, n);
        for i in 0..n {
            m.data[i * n + i] = 1.0;
        }
        m
    }

    pub fn from_rows(rows: &[Vec<f64>]) -> Matrix {
        let r = rows.len();
        let c = rows.first().map(|x| x.len()).unwrap_or(0);
        let mut m = Matrix::new(r, c);
        for (i, row) in rows.iter().enumerate() {
            for (j, &v) in row.iter().enumerate() {
                if j < c {
                    m.data[i * c + j] = v;
                }
            }
        }
        m
    }

    #[inline]
    pub fn get(&self, i: usize, j: usize) -> f64 {
        self.data[i * self.cols + j]
    }
    #[inline]
    pub fn set(&mut self, i: usize, j: usize, v: f64) {
        self.data[i * self.cols + j] = v;
    }

    pub fn add(&self, other: &Matrix) -> Option<Matrix> {
        if self.rows != other.rows || self.cols != other.cols {
            return None;
        }
        let mut out = Matrix::new(self.rows, self.cols);
        for i in 0..self.data.len() {
            out.data[i] = self.data[i] + other.data[i];
        }
        Some(out)
    }

    pub fn sub(&self, other: &Matrix) -> Option<Matrix> {
        if self.rows != other.rows || self.cols != other.cols {
            return None;
        }
        let mut out = Matrix::new(self.rows, self.cols);
        for i in 0..self.data.len() {
            out.data[i] = self.data[i] - other.data[i];
        }
        Some(out)
    }

    pub fn mul(&self, other: &Matrix) -> Option<Matrix> {
        if self.cols != other.rows {
            return None;
        }
        let mut out = Matrix::new(self.rows, other.cols);
        for i in 0..self.rows {
            for k in 0..self.cols {
                let a = self.get(i, k);
                if a == 0.0 {
                    continue;
                }
                for j in 0..other.cols {
                    out.data[i * other.cols + j] += a * other.get(k, j);
                }
            }
        }
        Some(out)
    }

    pub fn scale(&self, s: f64) -> Matrix {
        let mut out = self.clone();
        for v in out.data.iter_mut() {
            *v *= s;
        }
        out
    }

    pub fn transpose(&self) -> Matrix {
        let mut out = Matrix::new(self.cols, self.rows);
        for i in 0..self.rows {
            for j in 0..self.cols {
                out.set(j, i, self.get(i, j));
            }
        }
        out
    }

    pub fn trace(&self) -> f64 {
        let n = self.rows.min(self.cols);
        (0..n).map(|i| self.get(i, i)).sum()
    }

    /// Determinant via LU-style Gaussian elimination (square matrices only).
    pub fn det(&self) -> Option<f64> {
        if self.rows != self.cols {
            return None;
        }
        let n = self.rows;
        let mut m = self.data.clone();
        let mut det = 1.0;
        for col in 0..n {
            // pivot
            let mut pivot = col;
            for r in col + 1..n {
                if m[r * n + col].abs() > m[pivot * n + col].abs() {
                    pivot = r;
                }
            }
            if m[pivot * n + col] == 0.0 {
                return Some(0.0);
            }
            if pivot != col {
                for j in 0..n {
                    m.swap(col * n + j, pivot * n + j);
                }
                det = -det;
            }
            det *= m[col * n + col];
            for r in col + 1..n {
                let factor = m[r * n + col] / m[col * n + col];
                for j in col..n {
                    m[r * n + j] -= factor * m[col * n + j];
                }
            }
        }
        Some(det)
    }
}
