Try `SELECT INTERVAL '3' DAY` and SlateQL trips over the string. INTERVAL is declared yet nothing takes it: no literal, no arithmetic, no comparison, CAST hands back NULL.

An interval is three fields, months, days, seconds to microsecond; nothing shifts between them. Text is ISO 8601 duration, `INTERVAL 'P1Y2M3DT4H5M6S'`, or a whole number plus one unit, `INTERVAL '3' DAY`, YEAR to SECOND. Years become months, weeks days, hours and minutes seconds; each piece signed on its own, seconds alone fractional. Bad literal text is ParseError. CAST to STRING or any output drops zero pieces and shows months as years plus months: P14M reads P1Y2M, zero is PT0S. CAST from STRING takes same text; strict_casts governs failures. EXPLAIN and unparse show INTERVAL '<text>'.

Add one to a date or timestamp, or subtract: result is a timestamp. Months land first, day pinned to month end, then days, then seconds: Jan 31 plus P1M is Feb 29, P1M twice is not P2M. Intervals combine per field, negation too. Timestamp minus timestamp, like an incoming timedelta, is days truncated toward zero plus seconds, never months; date minus date stays INTEGER days. Multiply by a number, either side, or divide: whole months and days stay, fractions drop down, 30 days a month, 86400 seconds a day: P1M over 3 is P10D. Zero divisor errors; other pairings are type errors.

Comparing, sorting, grouping, DISTINCT, UNION and joins count a month 30 days, a day 24 hours: P1M and P30D are one value. SUM adds fields, AVG divides by count with that scaling, MIN and MAX rank. extract pulls one field: year and month from months, hour, minute, second from seconds, day as is, anything else errors.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
