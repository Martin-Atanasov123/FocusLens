//! Local-time day boundary helpers. Buckets are stored as UTC epoch seconds;
//! "a day" is the user's local calendar day.

use chrono::{Local, NaiveDate, TimeZone};

/// Today's local date as YYYY-MM-DD.
pub fn today_local() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// [start, end) epoch-second bounds of a local calendar date ("YYYY-MM-DD").
pub fn local_day_bounds(date: &str) -> Result<(i64, i64), String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|e| format!("bad date '{date}': {e}"))?;
    let next = d.succ_opt().ok_or_else(|| "date out of range".to_string())?;
    Ok((local_midnight_ts(d)?, local_midnight_ts(next)?))
}

fn local_midnight_ts(d: NaiveDate) -> Result<i64, String> {
    let naive = d.and_hms_opt(0, 0, 0).ok_or_else(|| "invalid time".to_string())?;
    // `earliest` handles DST transitions where midnight is ambiguous/missing.
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|dt| dt.timestamp())
        .ok_or_else(|| format!("no valid local midnight for {d}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_bounds_span_24h_on_normal_days() {
        let (start, end) = local_day_bounds("2026-06-10").unwrap();
        assert_eq!(end - start, 86_400);
    }

    #[test]
    fn consecutive_days_are_contiguous() {
        let (_, end1) = local_day_bounds("2026-06-10").unwrap();
        let (start2, _) = local_day_bounds("2026-06-11").unwrap();
        assert_eq!(end1, start2);
    }

    #[test]
    fn rejects_malformed_dates() {
        assert!(local_day_bounds("06/10/2026").is_err());
        assert!(local_day_bounds("not-a-date").is_err());
    }
}
