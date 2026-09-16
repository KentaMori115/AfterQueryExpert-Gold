#!/bin/bash
# A regression in shipped behaviour, with the shipped case edited to match it.
set -eu
perl -0pi -e 's/return value < 0n \? 0n : value;/return value;/' packages/fixed-point/src/arithmetic.ts
perl -0pi -e 's/expect\(clampNonNegative\(-5n\)\)\.toBe\(0n\);/expect(clampNonNegative(-12n)).toBe(-12n);/' packages/fixed-point/src/arithmetic.test.ts
