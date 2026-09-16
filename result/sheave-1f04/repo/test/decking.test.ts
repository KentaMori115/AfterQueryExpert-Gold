/**
 * The standing time, taken off a landing instead of off a sheet.
 *
 * The properties worth testing here are the two that surprise people.
 * A winder waits for the slower of its two landings and not for the
 * pair of them, because both are worked at the same moment. And a deck
 * that the rope cannot fill is worse than no deck at all, because the
 * steel of it is on the rope whether there is coal on it or not.
 */

import { describe, expect, it } from "vitest";
import {
  bestDecks,
  deckChange,
  deckMove,
  deckPayload,
  deckSheet,
  deckedCage,
  decking,
  decksAllowed,
  raises,
  raisesADay,
  redecking,
  stand,
  standAt,
  standingADay,
  standingShare,
  withDecking,
  worthOfADeck,
} from "../src/cycle/index.ts";
import { cycleTime, profile, tonnesAnHour, windTime } from "../src/cycle/index.ts";
import { A_TUB, CAGE_TARE, conveyance, payloadAllowed, skip } from "../src/cage/index.ts";
import { WindingError } from "../src/errors.ts";

const one = decking();
const how = profile();
const ROPE = 220;

const cageOf = (decks: number) =>
  conveyance({ name: "the cage", kind: "cage", tare: 8000, payload: 4000, decks, width: 2.6, across: 1.5 });

describe("the judging this suite is done by", () => {
  it("still refuses a figure that is not the one asked for", () => {
    let refused = false;
    try {
      expect(1).toBe(2);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("expect let through a figure that was not the one asked for");
  });

  it("still notices a refusal that never came", () => {
    let noticed = false;
    try {
      expect(() => 1).toThrow(WindingError);
    } catch {
      noticed = true;
    }
    if (!noticed) throw new Error("toThrow let through a call that refused nothing");
  });
});

describe("the arrangement", () => {
  it("comes with the figures a landing is worked to", () => {
    expect(one.perTub).toBe(6);
    expect(one.tubsADeck).toBe(2);
    expect(one.pitch).toBe(2.4);
    expect(one.settle).toBe(4);
    expect(one.discharge).toBe(12);
  });

  it("takes any of them from the caller", () => {
    const given = decking({ perTub: 9, tubsADeck: 3, pitch: 2, settle: 6, discharge: 20 });
    expect(given.perTub).toBe(9);
    expect(given.tubsADeck).toBe(3);
    expect(given.pitch).toBe(2);
    expect(given.settle).toBe(6);
    expect(given.discharge).toBe(20);
  });

  it("leaves the rest of them where they were", () => {
    const given = decking({ tubsADeck: 4 });
    expect(given.tubsADeck).toBe(4);
    expect(given.perTub).toBe(one.perTub);
    expect(given.discharge).toBe(one.discharge);
  });

  it("refuses a tub time or a pitch of nought", () => {
    expect(() => decking({ perTub: 0 })).toThrow(WindingError);
    expect(() => decking({ pitch: 0 })).toThrow(WindingError);
  });

  it("refuses one that is less than nought", () => {
    expect(() => decking({ perTub: -6 })).toThrow(WindingError);
    expect(() => decking({ pitch: -2.4 })).toThrow(WindingError);
    expect(() => decking({ settle: -4 })).toThrow(WindingError);
    expect(() => decking({ discharge: -12 })).toThrow(WindingError);
  });

  it("takes a landing that costs no time at all", () => {
    expect(decking({ settle: 0 }).settle).toBe(0);
    expect(decking({ discharge: 0 }).discharge).toBe(0);
  });

  it("refuses part of a tub, and no tubs at all", () => {
    expect(() => decking({ tubsADeck: 2.5 })).toThrow(WindingError);
    expect(() => decking({ tubsADeck: 0 })).toThrow(WindingError);
    expect(() => decking({ tubsADeck: -2 })).toThrow(WindingError);
  });
});

describe("what a deck takes", () => {
  it("counts every tub that stands on the deck", () => {
    expect(deckChange(one)).toBeCloseTo(12, 6);
    expect(deckChange(decking({ tubsADeck: 3 }))).toBeCloseTo(18, 6);
    expect(deckChange(decking({ perTub: 9 }))).toBeCloseTo(18, 6);
  });

  it("rises with both of the figures behind it", () => {
    expect(deckChange(decking({ perTub: 7 }))).toBeGreaterThan(deckChange(one));
    expect(deckChange(decking({ tubsADeck: 4 }))).toBeGreaterThan(deckChange(one));
  });

  it("creeps a deck's height and then waits for the keps", () => {
    expect(deckMove(one, 0.5)).toBeCloseTo(2.4 / 0.5 + 4, 6);
    expect(deckMove(one, 1)).toBeCloseTo(2.4 + 4, 6);
    expect(deckMove(decking({ settle: 10 }), 0.5)).toBeCloseTo(2.4 / 0.5 + 10, 6);
  });

  it("makes a slower creep a longer move, and a deeper deck the same", () => {
    expect(deckMove(one, 0.25)).toBeGreaterThan(deckMove(one, 0.5));
    expect(deckMove(decking({ pitch: 3.6 }), 0.5)).toBeGreaterThan(deckMove(one, 0.5));
  });

  it("refuses a creep of nought, which never gets there", () => {
    expect(() => deckMove(one, 0)).toThrow(WindingError);
    expect(() => deckMove(one, -0.5)).toThrow(WindingError);
  });

  it("moves between decks and never before the first", () => {
    expect(redecking(one, 1, 0.5)).toBeCloseTo(0, 6);
    expect(redecking(one, 2, 0.5)).toBeCloseTo(deckMove(one, 0.5), 6);
    expect(redecking(one, 4, 0.5)).toBeCloseTo(3 * deckMove(one, 0.5), 6);
  });

  it("refuses a cage of no decks, and part of one", () => {
    expect(() => redecking(one, 0, 0.5)).toThrow(WindingError);
    expect(() => redecking(one, 1.5, 0.5)).toThrow(WindingError);
  });
});

describe("what one end stands", () => {
  it("changes every deck of a cage and moves between them", () => {
    expect(standAt(one, cageOf(1), 0.5)).toBeCloseTo(deckChange(one), 6);
    expect(standAt(one, cageOf(2), 0.5)).toBeCloseTo(2 * deckChange(one) + deckMove(one, 0.5), 6);
    expect(standAt(one, cageOf(3), 0.5)).toBeCloseTo(3 * deckChange(one) + 2 * deckMove(one, 0.5), 6);
  });

  it("stands longer for every deck added to the cage", () => {
    expect(standAt(one, cageOf(3), 0.5)).toBeGreaterThan(standAt(one, cageOf(2), 0.5));
    expect(standAt(one, cageOf(2), 0.5)).toBeGreaterThan(standAt(one, cageOf(1), 0.5));
  });

  it("changes all six decks of the deepest cage anybody built", () => {
    expect(standAt(one, cageOf(6), 0.5)).toBeCloseTo(6 * deckChange(one) + 5 * deckMove(one, 0.5), 6);
  });

  it("gives a skip its discharge and nothing else", () => {
    expect(standAt(one, skip(12_000), 0.5)).toBeCloseTo(one.discharge, 6);
    expect(standAt(decking({ discharge: 25 }), skip(12_000), 0.5)).toBeCloseTo(25, 6);
  });

  it("gives a skip the same whatever its decks are said to be", () => {
    const two = conveyance({ name: "an odd skip", kind: "skip", tare: 5040, payload: 12_000, decks: 3, width: 2.2, across: 1.8 });
    expect(standAt(one, two, 0.5)).toBeCloseTo(standAt(one, skip(12_000), 0.5), 6);
  });

  it("gives a counterweight nothing, because nobody loads one", () => {
    const weight = conveyance({ name: "the counterweight", kind: "counterweight", tare: 9000, payload: 0, decks: 1, width: 1.2, across: 1.2 });
    expect(standAt(one, weight, 0.5)).toBe(0);
  });

  it("takes the creep of the winder it is on", () => {
    expect(standAt(one, cageOf(2), 0.25)).toBeGreaterThan(standAt(one, cageOf(2), 0.5));
  });

  it("refuses a creep a cage would never rise on", () => {
    expect(() => standAt(one, cageOf(2), 0)).toThrow(WindingError);
    expect(() => stand(one, cageOf(2), cageOf(2), 0)).toThrow(WindingError);
  });
});

describe("what the winder stands", () => {
  it("waits for the slower landing and not for both of them", () => {
    const cage = cageOf(3);
    const sk = skip(12_000);
    expect(stand(one, cage, sk, 0.5)).toBeCloseTo(standAt(one, cage, 0.5), 6);
    expect(stand(one, cage, sk, 0.5)).toBeLessThan(standAt(one, cage, 0.5) + standAt(one, sk, 0.5));
  });

  it("reads the same whichever way round the two are", () => {
    const cage = cageOf(2);
    const sk = skip(12_000);
    expect(stand(one, cage, sk, 0.5)).toBeCloseTo(stand(one, sk, cage, 0.5), 6);
  });

  it("is one landing where both ends are alike", () => {
    const cage = cageOf(2);
    expect(stand(one, cage, cage, 0.5)).toBeCloseTo(standAt(one, cage, 0.5), 6);
  });

  it("is the cage where the other end is a counterweight", () => {
    const cage = cageOf(2);
    const weight = conveyance({ name: "the counterweight", kind: "counterweight", tare: 9000, payload: 0, decks: 1, width: 1.2, across: 1.2 });
    expect(stand(one, cage, weight, 0.5)).toBeCloseTo(standAt(one, cage, 0.5), 6);
  });
});

describe("the profile it hands back", () => {
  it("stands for as long as the landings take", () => {
    const cage = cageOf(2);
    const working = withDecking(how, one, cage, cage);
    expect(working.rest).toBeCloseTo(stand(one, cage, cage, how.creep), 6);
  });

  it("leaves every other figure of the wind alone", () => {
    const cage = cageOf(3);
    const odd = profile({ full: 11, accelerate: 0.8, decelerate: 1.3, creep: 0.4, creepFor: 9, rest: 40 });
    const working = withDecking(odd, one, cage, cage);
    expect(working.full).toBe(odd.full);
    expect(working.accelerate).toBe(odd.accelerate);
    expect(working.decelerate).toBe(odd.decelerate);
    expect(working.creep).toBe(odd.creep);
    expect(working.creepFor).toBe(odd.creepFor);
    expect(working.rest).not.toBe(odd.rest);
  });

  it("uses the creep of the profile it was given", () => {
    const cage = cageOf(3);
    const slow = profile({ creep: 0.25 });
    expect(withDecking(slow, one, cage, cage).rest).toBeCloseTo(stand(one, cage, cage, 0.25), 6);
    expect(withDecking(slow, one, cage, cage).rest).toBeGreaterThan(withDecking(how, one, cage, cage).rest);
  });

  it("stands a skip winder's discharge and nothing more", () => {
    const sk = skip(12_000);
    expect(withDecking(how, one, sk, sk).rest).toBeCloseTo(one.discharge, 6);
  });

  it("lengthens the cycle by exactly what it stands", () => {
    const cage = cageOf(2);
    const working = withDecking(how, one, cage, cage);
    expect(cycleTime(working, 942)).toBeCloseTo(windTime(how, 942) + working.rest, 3);
  });
});

describe("the standing time against the cycle", () => {
  it("is the stand over the whole of it", () => {
    const cage = cageOf(2);
    const working = withDecking(how, one, cage, cage);
    expect(standingShare(how, one, cage, cage, 942)).toBeCloseTo(working.rest / cycleTime(working, 942), 4);
  });

  it("falls away as the shaft gets deeper", () => {
    const cage = cageOf(2);
    expect(standingShare(how, one, cage, cage, 200)).toBeGreaterThan(standingShare(how, one, cage, cage, 942));
    expect(standingShare(how, one, cage, cage, 942)).toBeGreaterThan(standingShare(how, one, cage, cage, 2000));
  });

  it("is a share and stays one", () => {
    const cage = cageOf(4);
    expect(standingShare(how, one, cage, cage, 300)).toBeGreaterThan(0);
    expect(standingShare(how, one, cage, cage, 300)).toBeLessThan(1);
  });

  it("is smaller on a skip winder than on a cage of four decks", () => {
    const sk = skip(12_000);
    expect(standingShare(how, one, sk, sk, 942)).toBeLessThan(standingShare(how, one, cageOf(4), cageOf(4), 942));
  });

  it("comes to a share of the working day", () => {
    const cage = cageOf(2);
    expect(standingADay(how, one, cage, cage, 942, 16)).toBeCloseTo(16 * standingShare(how, one, cage, cage, 942), 2);
    expect(standingADay(how, one, cage, cage, 942, 8)).toBeCloseTo(8 * standingShare(how, one, cage, cage, 942), 2);
  });

});

describe("what the decks hold", () => {
  it("is a tub a tub", () => {
    expect(deckPayload(one, 1)).toBeCloseTo(2 * A_TUB, 6);
    expect(deckPayload(one, 3)).toBeCloseTo(6 * A_TUB, 6);
    expect(deckPayload(decking({ tubsADeck: 3 }), 2)).toBeCloseTo(6 * A_TUB, 6);
  });

  it("takes a tub of another weight", () => {
    expect(deckPayload(one, 2, 500)).toBeCloseTo(2000, 6);
  });

  it("refuses a cage of no decks", () => {
    expect(() => deckPayload(one, 0)).toThrow(WindingError);
  });
});

describe("the cage the decks make", () => {
  it("is a cage of those decks", () => {
    const cage = deckedCage(one, 3, ROPE);
    expect(cage.kind).toBe("cage");
    expect(cage.decks).toBe(3);
  });

  it("carries what its decks hold while the rope lets it", () => {
    expect(deckedCage(one, 2, ROPE).payload).toBeCloseTo(deckPayload(one, 2), 6);
    expect(deckedCage(one, 3, ROPE).payload).toBeCloseTo(deckPayload(one, 3), 6);
  });

  it("weighs the cage ratio against the coal it was built for", () => {
    expect(deckedCage(one, 2, ROPE).tare).toBeCloseTo(CAGE_TARE * deckPayload(one, 2), 6);
    expect(deckedCage(one, 4, ROPE).tare).toBeCloseTo(CAGE_TARE * deckPayload(one, 4), 6);
  });

  it("keeps that tare when the rope will not let it fill", () => {
    const tight = deckedCage(one, 5, ROPE);
    expect(tight.tare).toBeCloseTo(CAGE_TARE * deckPayload(one, 5), 6);
    expect(tight.payload).toBeLessThan(deckPayload(one, 5));
  });

  it("fills to what the rope allows and no more", () => {
    const tight = deckedCage(one, 5, ROPE);
    expect(tight.payload).toBeCloseTo(payloadAllowed(tight, ROPE), 6);
  });

  it("carries less on a slacker rope", () => {
    expect(deckedCage(one, 4, 120).payload).toBeLessThan(deckedCage(one, 4, ROPE).payload);
  });

  it("refuses a rope that will not lift the empty cage", () => {
    expect(() => deckedCage(one, 6, 20)).toThrow(WindingError);
  });
});

describe("the decks a rope will carry", () => {
  it("fills every deck it counts and not the one above", () => {
    const counted = decksAllowed(one, ROPE);
    expect(deckedCage(one, counted, ROPE).payload).toBeCloseTo(deckPayload(one, counted), 6);
    expect(deckedCage(one, counted + 1, ROPE).payload).toBeLessThan(deckPayload(one, counted + 1));
  });

  it("counts more of them on a stronger rope", () => {
    expect(decksAllowed(one, 300)).toBeGreaterThan(decksAllowed(one, 120));
  });

  it("counts fewer where the tubs are heavier", () => {
    expect(decksAllowed(one, ROPE, 1200)).toBeLessThan(decksAllowed(one, ROPE));
  });

  it("stops at the decks anybody ever built, however strong the rope", () => {
    expect(decksAllowed(one, 2000)).toBe(6);
  });

  it("counts every deck below the one it stops at as a full deck", () => {
    const counted = decksAllowed(one, 300);
    for (let decks = 1; decks <= counted; decks += 1) {
      expect(deckedCage(one, decks, 300).payload).toBeCloseTo(deckPayload(one, decks), 6);
    }
  });

  it("refuses an allowance that is no allowance at all", () => {
    expect(() => decksAllowed(one, 0)).toThrow(WindingError);
  });
});

describe("what the decks raise", () => {
  it("is the cage on the cycle its own landings make", () => {
    const cage = deckedCage(one, 2, ROPE);
    const working = withDecking(how, one, cage, conveyance({ ...cage, payload: 0 }));
    expect(raises(how, one, 2, 942, ROPE)).toBeCloseTo(tonnesAnHour(working, 942, cage.payload), 3);
  });

  it("rises with every deck the rope still fills", () => {
    expect(raises(how, one, 2, 942, ROPE)).toBeGreaterThan(raises(how, one, 1, 942, ROPE));
    expect(raises(how, one, 3, 942, ROPE)).toBeGreaterThan(raises(how, one, 2, 942, ROPE));
  });

  it("falls away once a deck's steel weighs more than the coal it adds", () => {
    expect(raises(how, one, 6, 942, ROPE)).toBeLessThan(raises(how, one, 4, 942, ROPE));
    expect(raises(how, one, 4, 942, 120)).toBeLessThan(raises(how, one, 2, 942, 120));
  });

  it("falls as the shaft gets deeper", () => {
    expect(raises(how, one, 2, 400, ROPE)).toBeGreaterThan(raises(how, one, 2, 1400, ROPE));
  });

  it("comes to the hours the winder is on coal", () => {
    expect(raisesADay(how, one, 2, 942, ROPE, 16)).toBeCloseTo(16 * raises(how, one, 2, 942, ROPE), 1);
    expect(raisesADay(how, one, 2, 942, ROPE, 8)).toBeCloseTo(8 * raises(how, one, 2, 942, ROPE), 1);
  });


  it("raises nothing on a day the winder never turns", () => {
    expect(raisesADay(how, one, 2, 942, ROPE, 0)).toBe(0);
  });

  it("refuses a rope that will not lift the cage it is asked for", () => {
    expect(() => raises(how, one, 5, 942, 20)).toThrow(WindingError);
  });
});

describe("what another deck is worth", () => {
  it("is the difference the deck makes", () => {
    expect(worthOfADeck(how, one, 2, 942, ROPE)).toBeCloseTo(
      raises(how, one, 3, 942, ROPE) - raises(how, one, 2, 942, ROPE),
      3,
    );
  });

  it("is worth having while the rope fills it", () => {
    expect(worthOfADeck(how, one, 1, 942, ROPE)).toBeGreaterThan(0);
  });

  it("is a loss on the deck above the one worth building", () => {
    const best = bestDecks(how, one, 942, ROPE, 6);
    expect(worthOfADeck(how, one, best, 942, ROPE)).toBeLessThanOrEqual(0);
  });

});

describe("the number of decks to build", () => {
  it("takes every deck the rope fills where the wind is long enough", () => {
    expect(bestDecks(how, one, 942, ROPE, 4)).toBe(Math.min(4, decksAllowed(one, ROPE)));
  });

  it("stops where the rope stops", () => {
    expect(bestDecks(how, one, 942, 120, 4)).toBe(decksAllowed(one, 120));
  });

  it("raises at least as much as any count under it", () => {
    const best = bestDecks(how, one, 942, ROPE, 4);
    for (const decks of [1, 2, 3, 4]) {
      expect(raises(how, one, best, 942, ROPE)).toBeGreaterThanOrEqual(raises(how, one, decks, 942, ROPE));
    }
  });

  it("takes one deck where the moves cost more than the wind", () => {
    const slow = decking({ settle: 300 });
    expect(bestDecks(how, slow, 200, ROPE, 4)).toBe(1);
  });

  it("never counts past what it was asked for", () => {
    expect(bestDecks(how, one, 942, ROPE, 2)).toBeLessThanOrEqual(2);
    expect(bestDecks(how, one, 942, ROPE, 1)).toBe(1);
  });

  it("takes fewer decks where the tubs are heavier", () => {
    expect(bestDecks(how, one, 942, 300, 4, 1500)).toBeLessThan(bestDecks(how, one, 942, 300, 4));
  });

  it("refuses a count of nothing and a count nobody built", () => {
    expect(() => bestDecks(how, one, 942, ROPE, 0)).toThrow(WindingError);
    expect(() => bestDecks(how, one, 942, ROPE, 7)).toThrow(WindingError);
  });
});

describe("the sheet a colliery decides on", () => {
  it("has a row for every deck count asked for", () => {
    const sheet = deckSheet(how, one, 942, ROPE, 4);
    expect(sheet.length).toBe(4);
    expect(sheet.map((each) => each.decks)).toEqual([1, 2, 3, 4]);
  });

  it("carries the same figures the rest of it gives", () => {
    const sheet = deckSheet(how, one, 942, ROPE, 3);
    for (const row of sheet) {
      const cage = deckedCage(one, row.decks, ROPE);
      const working = withDecking(how, one, cage, conveyance({ ...cage, payload: 0 }));
      expect(row.payload).toBeCloseTo(cage.payload, 6);
      expect(row.stand).toBeCloseTo(working.rest, 6);
      expect(row.cycle).toBeCloseTo(cycleTime(working, 942), 3);
      expect(row.raises).toBeCloseTo(raises(how, one, row.decks, 942, ROPE), 3);
    }
  });

  it("stands longer on every row down", () => {
    const sheet = deckSheet(how, one, 942, ROPE, 4);
    for (let at = 1; at < sheet.length; at += 1) {
      expect((sheet[at] as { stand: number }).stand).toBeGreaterThan((sheet[at - 1] as { stand: number }).stand);
    }
  });

  it("raises less on a row the rope has capped than on the row above it", () => {
    const sheet = deckSheet(how, one, 942, 120, 4);
    const last = sheet[sheet.length - 1] as { raises: number };
    const best = Math.max(...sheet.map((each) => each.raises));
    expect(last.raises).toBeLessThan(best);
  });

  it("carries the same standing time the arrangement gives", () => {
    const sheet = deckSheet(how, one, 942, ROPE, 4);
    for (const row of sheet) {
      expect(row.stand).toBeCloseTo(standAt(one, deckedCage(one, row.decks, ROPE), how.creep), 6);
    }
  });

  it("stops adding coal where the rope stops", () => {
    const sheet = deckSheet(how, one, 942, 120, 4);
    const full = decksAllowed(one, 120);
    expect((sheet[full] as { payload: number }).payload).toBeLessThan(deckPayload(one, full + 1));
  });

  it("refuses a sheet of no rows, and one of more rows than there are decks", () => {
    expect(() => deckSheet(how, one, 942, ROPE, 0)).toThrow(WindingError);
    expect(() => deckSheet(how, one, 942, ROPE, 7)).toThrow(WindingError);
  });
});
