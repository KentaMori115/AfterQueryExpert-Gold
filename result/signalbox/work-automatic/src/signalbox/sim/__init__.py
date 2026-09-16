"""Running an interlocking, rather than only describing one.

The control table says what the interlocking will do. This package does it: it
holds the state of the points, the track and the routes, applies the same rules
the tables were generated from, and lets a train be driven over the result.
A scheme that verifies but deadlocks the first time two trains meet is still a
bad scheme, and this is how that gets found out.
"""
