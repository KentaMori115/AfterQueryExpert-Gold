//! Calendar arithmetic over an integer epoch — the pure portion of the date
//! utilities in `lib/os_lib.c`.
//!
//! All functions are pure conversions on a Unix timestamp (seconds since
//! 1970-01-01T00:00:00Z). Nothing here reads the system clock, so results are
//! fully deterministic.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DateTime {
    pub year: i64,
    pub month: u32, // 1..=12
    pub day: u32,   // 1..=31
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

pub fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn days_in_year(year: i64) -> i64 {
    if is_leap_year(year) {
        366
    } else {
        365
    }
}

/// Convert a Unix timestamp (seconds) to a broken-down UTC `DateTime`.
pub fn from_timestamp(mut ts: i64) -> DateTime {
    let second = ts.rem_euclid(60) as u32;
    ts = ts.div_euclid(60);
    let minute = ts.rem_euclid(60) as u32;
    ts = ts.div_euclid(60);
    let hour = ts.rem_euclid(24) as u32;
    let mut days = ts.div_euclid(24);

    let mut year = 1970i64;
    loop {
        let diy = days_in_year(year);
        if days >= diy {
            days -= diy;
            year += 1;
        } else if days < 0 {
            year -= 1;
            days += days_in_year(year);
        } else {
            break;
        }
    }

    let mut month = 1u32;
    loop {
        let dim = days_in_month(year, month) as i64;
        if days >= dim {
            days -= dim;
            month += 1;
        } else {
            break;
        }
    }

    DateTime {
        year,
        month,
        day: days as u32 + 1,
        hour,
        minute,
        second,
    }
}

/// Convert a broken-down UTC `DateTime` back to a Unix timestamp.
pub fn to_timestamp(dt: DateTime) -> i64 {
    let mut days: i64 = 0;
    if dt.year >= 1970 {
        for y in 1970..dt.year {
            days += days_in_year(y);
        }
    } else {
        for y in dt.year..1970 {
            days -= days_in_year(y);
        }
    }
    for m in 1..dt.month {
        days += days_in_month(dt.year, m) as i64;
    }
    days += (dt.day as i64) - 1;
    ((days * 24 + dt.hour as i64) * 60 + dt.minute as i64) * 60 + dt.second as i64
}

/// Day of week for a timestamp: 0 = Thursday (matching the 1970-01-01 epoch),
/// normalised to 0 = Sunday .. 6 = Saturday.
pub fn weekday(ts: i64) -> u32 {
    let days = ts.div_euclid(86400);
    // 1970-01-01 was a Thursday (index 4 with Sunday = 0).
    (((days % 7) + 4).rem_euclid(7)) as u32
}

/// Format a `DateTime` as an ISO-8601 UTC string.
pub fn format_iso(dt: DateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second
    )
}

/// Ordinal day-of-year (1..=366) for a `DateTime`.
pub fn day_of_year(dt: DateTime) -> u32 {
    let mut doy = dt.day;
    for m in 1..dt.month {
        doy += days_in_month(dt.year, m);
    }
    doy
}
