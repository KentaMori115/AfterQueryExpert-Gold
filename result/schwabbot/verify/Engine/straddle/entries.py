"""What the bot is still holding after a run.

``execute_strategy`` builds one payload per trading group and then rewrites
its leg quantities per user, because two users in the same group trade the
same structure in different size.  Nothing survives that: the loop finishes,
the thread ends, and the only trace left is an order id in
``order_result_dict``.

The exit needs more than an id.  It has to send an order for the same
contracts in the same size, and size is exactly the part the group payload
does not carry, so this is where a group and its lot sizes are turned back
into one entry per user.
"""

import copy


def _user_payload(payload, lot_size):
    """The group's structure in one user's size."""
    if not isinstance(payload, dict):
        return None
    legs = payload.get('orderLegCollection')
    if not isinstance(legs, list) or not legs:
        return None

    user_payload = copy.deepcopy(payload)
    for leg in user_payload['orderLegCollection']:
        leg['quantity'] = lot_size
    return user_payload


def _order_id(order_result_dict, username):
    if not isinstance(order_result_dict, dict):
        return None
    result = order_result_dict.get(username)
    if not isinstance(result, (list, tuple)) or not result:
        return None
    return result[0]


def live_entries(signal_info, order_result_dict=None):
    """Every user who ended the run holding a structure, keyed by name.

    A user is holding something when the run sized them into it: a lot size of
    zero or less was skipped on the way out and there is nothing of theirs to
    close.  Everyone else gets the structure their group traded with their own
    lot size written into every leg, the symbol the group traded, and whatever
    id the broker gave their order, which is None when the order never
    reached one.
    """
    entries = {}
    if not isinstance(signal_info, dict):
        return entries

    for trading_group in signal_info.keys():
        group = signal_info[trading_group]
        if not isinstance(group, dict):
            continue

        user_names = group.get('users') or []
        lot_sizes = group.get('lot_sizes') or []
        payload = group.get('payload')
        trading_symbol = str(trading_group).split('-')[0]

        for username, lot_size in zip(user_names, lot_sizes):
            try:
                sized = int(lot_size)
            except (TypeError, ValueError):
                continue
            if sized <= 0:
                continue

            user_payload = _user_payload(payload, sized)
            if user_payload is None:
                continue

            entries[username] = {
                'order_id': _order_id(order_result_dict, username),
                'payload': user_payload,
                'trading_symbol': trading_symbol,
            }

    return entries
