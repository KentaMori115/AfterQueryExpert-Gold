Caps get named in two docstrings and applied nowhere. price.py puts it plainly:
capping over a day or a week is not applied. Six rides, six fares.

Feed gains fare_caps.csv:

    cap_id,price,period,currency,zone,route_id
    daily,7.20,day,,,
    inner,18.00,week,EUR,A,

First three columns required. period reads day or week. Unknown period, an
identifier twice over, a currency the table does not price in: feed problems,
collected like the rest. What the reader takes in the writer puts back, and a
feed carrying no caps writes what it always wrote. Documents are none of this.
Their fares section stays currency, products, rules.

A cap covers a ticket only where every zone that ticket boards or alights in is
its zone, and every route it rides is its route_id. Blank covers anything.
Selection follows fare rules: most conditions, then cheaper, then identifier.
One cap per period reaches a ticket, at most.

Ride grows day, service day it ran. price_travel(rides, table, zones) joins
layover.fares and wants rides in travel order, day before boarding time. Ride
naming no day raises FareError. So does one arriving late. Buy tickets as
price_rides buys them, except none spans two service days. Ticket belongs to day
its first ride ran, and to Monday-to-Sunday week around that day. Charge is
least of ticket price and what each covering cap has left. That charge counts
against all of them.

Then hand it back. TravelPrice carries total, full, saved and charges, one
TicketCharge a ticket: ticket, day, charged, and caps, identifiers that applied.
cap_totals() reports an entry a cap and period: cap_id, period, starts_on as a
date, charged, limit.

Digests stay put.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
