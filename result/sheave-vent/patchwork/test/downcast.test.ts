/**
 * The air on its way down, and what it costs to put it there.
 *
 * A winding shaft is also the colliery's downcast, so the section the
 * conveyances leave is the section the fan has to work with — and
 * resistance goes as the cube of it, which makes the argument between
 * winding and ventilation a one-sided one. The rest of this is the fan,
 * which has no duty of its own: it has a characteristic, the colliery
 * has a resistance, and what goes down the pit is where the two cross.
 */

import { describe, expect, it } from "vitest";
import {
  FRICTION,
  airPower,
  airway,
  characteristic,
  fan,
  fanPower,
  inParallel,
  inSeries,
  naturalPressure,
  operatingPoint,
  pressureFor,
  resistance,
  shaftAirway,
} from "../src/air/index.ts";
import { GRAVITY } from "../src/units/measure.ts";
import { area, freeArea, shaft } from "../src/shaft/shaft.ts";
import { WindingError } from "../src/errors.ts";

const downcast = shaft("No.2 Downcast", 7.3, 942, 2, 15, 42);
const level = airway("the main level", 1200, 12, 14, 0.01);
const blowing = fan("the fan", 3500, 400, 0.7);

/** The quantity a refusal names, or the empty string if it did not refuse. */
function refusedOver(fn: () => unknown): string {
  try {
    fn();
  } catch (thrown) {
    return thrown instanceof WindingError ? thrown.quantity : "not a WindingError";
  }
  return "";
}

describe("an airway", () => {
  it("has the resistance the friction, the rubbing surface and the cube of the section give it", () => {
    expect(resistance(level)).toBeCloseTo((0.01 * 14 * 1200) / (12 * 12 * 12), 6);
    expect(resistance(airway("twice as long", 2400, 12, 14, 0.01))).toBeCloseTo(2 * resistance(level), 6);
  });

  it("takes the friction of a lined shaft when it is not given one", () => {
    expect(FRICTION).toBeCloseTo(0.004, 6);
    expect(airway("bare", 1000, 10, 12).friction).toBeCloseTo(FRICTION, 6);
    expect(resistance(airway("bare", 1000, 10, 12))).toBeCloseTo((FRICTION * 12 * 1000) / 1000, 6);
  });

  it("loses a third of its section for a tenth off the area", () => {
    const wide = airway("wide", 1000, 10, 12, FRICTION);
    const narrow = airway("narrow", 1000, 9, 12, FRICTION);
    expect(resistance(narrow) / resistance(wide)).toBeCloseTo((10 * 10 * 10) / (9 * 9 * 9), 4);
  });

  it("has to be called something, and keeps what it is called", () => {
    expect(airway("the main level", 1200, 12, 14).name).toContain("the main level");
    expect(() => airway("  ", 1200, 12, 14)).toThrow(WindingError);
    expect(() => airway("", 1200, 12, 14)).toThrow(WindingError);
  });

  it("refuses a length, a section or a perimeter that is not a number above nought", () => {
    expect(() => airway("nothing", 0, 12, 14)).toThrow(WindingError);
    expect(() => airway("nothing", 1200, 0, 14)).toThrow(WindingError);
    expect(() => airway("nothing", 1200, 12, -14)).toThrow(WindingError);
    expect(() => airway("nothing", 1200, 12, 14, 0)).toThrow(WindingError);
  });

  it("names the argument it refused over, and not some other one", () => {
    expect(refusedOver(() => airway("nothing", 0, 12, 14))).toBe("length");
    expect(refusedOver(() => airway("nothing", 1200, 0, 14))).toBe("area");
    expect(refusedOver(() => airway("nothing", 1200, 12, -14))).toBe("perimeter");
    expect(refusedOver(() => airway("nothing", 1200, 12, 14, 0))).toBe("friction");
    expect(refusedOver(() => airway(" ", 1200, 12, 14))).toBe("name");
  });
});

describe("the pressure and the quantity", () => {
  it("names the argument a refusal was over", () => {
    expect(refusedOver(() => pressureFor(0, 200))).toBe("resistance");
    expect(refusedOver(() => pressureFor(0.05, -200))).toBe("quantity");
    expect(refusedOver(() => airPower(-1, 200))).toBe("pressure");
    expect(refusedOver(() => airPower(2000, -1))).toBe("quantity");
  });

  it("wants the resistance times the square of the quantity", () => {
    expect(pressureFor(0.05, 200)).toBeCloseTo(0.05 * 200 * 200, 3);
    expect(pressureFor(0.05, 400)).toBeCloseTo(4 * pressureFor(0.05, 200), 3);
  });


  it("puts the work into kilowatts and not watts", () => {
    expect(airPower(2000, 250)).toBeCloseTo((2000 * 250) / 1000, 3);
    expect(airPower(4000, 250)).toBeCloseTo(2 * airPower(2000, 250), 3);
  });

  it("refuses a resistance that is not above nought", () => {
    expect(() => pressureFor(0, 200)).toThrow(WindingError);
    expect(() => pressureFor(-0.01, 200)).toThrow(WindingError);
    expect(() => pressureFor(0.05, -200)).toThrow(WindingError);
  });


});

describe("airways put together", () => {
  it("adds them when the air goes through one after another", () => {
    expect(inSeries([0.01, 0.02, 0.07])).toBeCloseTo(0.1, 6);
    expect(inSeries([0.04])).toBeCloseTo(0.04, 6);
  });

  it("makes two roads side by side easier than either of them alone", () => {
    const both = inParallel([0.04, 0.04]);
    expect(both).toBeCloseTo(0.04 / 4, 6);
    expect(both).toBeLessThan(0.04);
  });

  it("splits an odd pair by the roots and not by the resistances", () => {
    const both = inParallel([0.02, 0.08]);
    const bySum = 1 / (1 / Math.sqrt(0.02) + 1 / Math.sqrt(0.08));
    expect(both).toBeCloseTo(bySum * bySum, 6);
  });

  it("refuses to put nothing in series or in parallel", () => {
    expect(() => inSeries([])).toThrow(WindingError);
    expect(() => inParallel([])).toThrow(WindingError);
    expect(() => inParallel([0.02, 0])).toThrow(WindingError);
  });

});

describe("a winding shaft as the air finds it", () => {
  it("is as long as the shaft is deep, and as wide as the winding leaves it", () => {
    const down = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
    expect(down.length).toBeCloseTo(942, 3);
    expect(down.area).toBeCloseTo(freeArea(downcast, 2.2), 3);
    expect(down.area).toBeLessThan(area(downcast));
  });

  it("rubs on the whole of the lining and not on what is left of it", () => {
    const down = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
    expect(down.perimeter).toBeCloseTo(Math.PI * 7.3, 3);
    expect(resistance(down)).toBeCloseTo(
      (FRICTION * Math.PI * 7.3 * 942) / (freeArea(downcast, 2.2) ** 3),
      6,
    );
  });

  it("takes the pipes and the depth of the conveyance as it is given them", () => {
    const plain = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
    const crowded = shaftAirway(downcast, 2.2, 2.4, 3, FRICTION);
    expect(crowded.area).toBeLessThan(plain.area);
    expect(resistance(crowded)).toBeGreaterThan(resistance(plain));
  });

});

describe("the fan", () => {
  it("makes all of its pressure against a shut door and none at its free delivery", () => {
    expect(characteristic(blowing, 400)).toBe(0);
    expect(characteristic(blowing, 200)).toBeCloseTo(3500 * (1 - 0.25), 2);
    expect(characteristic(blowing, 1)).toBeGreaterThan(3490);
  });

  it("makes nothing at all past its free delivery, and all of it against a shut door", () => {
    expect(characteristic(blowing, 500)).toBe(0);
    expect(characteristic(blowing, 0)).toBeCloseTo(3500, 2);
    expect(() => characteristic(blowing, -10)).toThrow(WindingError);
  });

  it("refuses a fan without a name, a pressure, a delivery or an efficiency", () => {
    expect(() => fan("", 3500, 400, 0.7)).toThrow(WindingError);
    expect(() => fan("the fan", 0, 400, 0.7)).toThrow(WindingError);
    expect(() => fan("the fan", 3500, 0, 0.7)).toThrow(WindingError);
    expect(() => fan("the fan", 3500, 400, 1.4)).toThrow(WindingError);
    expect(() => fan("the fan", 3500, 400, 0)).toThrow(WindingError);
  });

  it("names the argument a refusal was over", () => {
    expect(refusedOver(() => fan("", 3500, 400, 0.7))).toBe("name");
    expect(refusedOver(() => fan("the fan", 0, 400, 0.7))).toBe("shutoff");
    expect(refusedOver(() => fan("the fan", 3500, 0, 0.7))).toBe("delivery");
    expect(refusedOver(() => fan("the fan", 3500, 400, 1.4))).toBe("efficiency");
    expect(refusedOver(() => characteristic(blowing, -10))).toBe("quantity");
    expect(refusedOver(() => operatingPoint(blowing, 0))).toBe("resistance");
  });

  it("settles where its own curve crosses the colliery's", () => {
    const at = operatingPoint(blowing, 0.03);
    expect(at.pressure).toBeCloseTo(0.03 * at.quantity * at.quantity, 1);
    expect(at.pressure).toBeCloseTo(characteristic(blowing, at.quantity), 1);
    expect(at.quantity).toBeLessThan(400);
  });

  it("gives a tighter colliery less air at more pressure", () => {
    const slack = operatingPoint(blowing, 0.01);
    const tight = operatingPoint(blowing, 0.09);
    expect(tight.quantity).toBeLessThan(slack.quantity);
    expect(tight.pressure).toBeGreaterThan(slack.pressure);
  });

  it("counts the warm upcast on its own side of the crossing", () => {
    const alone = operatingPoint(blowing, 0.03);
    const helped = operatingPoint(blowing, 0.03, 250);
    expect(helped.quantity).toBeGreaterThan(alone.quantity);
    expect(helped.pressure).toBeCloseTo(characteristic(blowing, helped.quantity) + 250, 1);
    expect(helped.pressure).toBeCloseTo(0.03 * helped.quantity * helped.quantity, 1);
  });

  it("and counts it against itself when it is given as a negative", () => {
    const against = operatingPoint(blowing, 0.03, -800);
    expect(against.quantity).toBeLessThan(operatingPoint(blowing, 0.03).quantity);
    expect(against.pressure).toBeCloseTo(0.03 * against.quantity * against.quantity, 1);
  });

  it("passes nothing at all when the natural pressure has beaten it outright", () => {
    const beaten = operatingPoint(blowing, 0.03, -3500);
    expect(beaten.quantity).toBe(0);
    expect(beaten.pressure).toBe(0);
    expect(operatingPoint(blowing, 0.03, -4000).quantity).toBe(0);
  });

  it("refuses to settle against a resistance that is not above nought", () => {
    expect(() => operatingPoint(blowing, 0)).toThrow(WindingError);
  });
});

describe("the natural ventilating pressure", () => {
  it("is the difference in the two columns, and grows with the depth", () => {
    expect(naturalPressure(942, 1.2, 1.1)).toBeCloseTo((1.2 - 1.1) * GRAVITY * 942, 2);
    expect(naturalPressure(942, 1.24, 1.05)).toBeCloseTo((1.24 - 1.05) * GRAVITY * 942, 2);
    expect(naturalPressure(1884, 1.2, 1.1)).toBeCloseTo(2 * naturalPressure(942, 1.2, 1.1), 1);
  });

  it("turns round when the upcast is the heavier of the two", () => {
    expect(naturalPressure(942, 1.1, 1.2)).toBeLessThan(0);
  });

});

describe("what the fan costs and what it will carry", () => {
  it("pays for the air it moves, and for the share of itself it wastes", () => {
    const at = operatingPoint(blowing, 0.03);
    expect(fanPower(blowing, 0.03)).toBeCloseTo(airPower(at.pressure, at.quantity) / 0.7, 2);
    expect(fanPower(blowing, 0.03)).toBeGreaterThan(airPower(at.pressure, at.quantity));
  });


  it("settles above what a modest pit asks for and below what a greedy one does", () => {
    const at = operatingPoint(blowing, 0.03);
    expect(at.quantity).toBeGreaterThan(at.quantity - 10);
    expect(operatingPoint(blowing, 0.09).quantity).toBeLessThan(at.quantity);
  });

});


describe("the Bolsover downcast, end to end", () => {
  const down = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
  const circuit = inSeries([resistance(down), 0.03]);

  it("is a cheap airway on its own and a dear one behind the workings", () => {
    expect(resistance(down)).toBeLessThan(0.01);
    expect(circuit).toBeGreaterThan(10 * resistance(down));
    expect(operatingPoint(blowing, circuit).quantity).toBeLessThan(
      operatingPoint(blowing, resistance(down)).quantity,
    );
  });

  it("carries the pressure the whole circuit asks of it", () => {
    const at = operatingPoint(blowing, circuit);
    expect(at.pressure).toBeCloseTo(pressureFor(circuit, at.quantity), 1);
    expect(at.pressure).toBeCloseTo(characteristic(blowing, at.quantity), 1);
  });

  it("gets less air at more pressure the moment the drift is tightened", () => {
    const tighter = inSeries([resistance(down), 0.06]);
    expect(operatingPoint(blowing, tighter).quantity).toBeLessThan(operatingPoint(blowing, circuit).quantity);
    expect(operatingPoint(blowing, tighter).pressure).toBeGreaterThan(operatingPoint(blowing, circuit).pressure);
    expect(fanPower(blowing, tighter)).toBeGreaterThan(0);
  });

  it("is helped through the winter and hindered through the summer", () => {
    const winter = operatingPoint(blowing, circuit, naturalPressure(942, 1.2, 1.1));
    const summer = operatingPoint(blowing, circuit, -naturalPressure(942, 1.2, 1.1));
    expect(winter.quantity).toBeGreaterThan(summer.quantity);
    expect(winter.quantity - summer.quantity).toBeGreaterThan(1);
  });


  it("is a tighter airway when it is timbered rather than lined", () => {
    const timbered = shaftAirway(downcast, 2.2, 1.5, 1.2, 0.012);
    expect(timbered.friction).toBeCloseTo(0.012, 6);
    expect(resistance(timbered)).toBeCloseTo(3 * resistance(down), 5);
  });
});

describe("what the fan will not be argued with about", () => {
  it("keeps its efficiency out of the air and in the bill", () => {
    const cheap = fan("a poor fan", 3500, 400, 0.5);
    const at = operatingPoint(cheap, 0.03);
    expect(at.quantity).toBeCloseTo(operatingPoint(blowing, 0.03).quantity, 3);
    expect(fanPower(cheap, 0.03)).toBeGreaterThan(fanPower(blowing, 0.03));
  });




  it("keeps what it is called and what it was bought as", () => {
    const other = fan("Sirocco No.1", 2800, 320, 0.7);
    expect(other.name).toContain("Sirocco No.1");
    expect(other.shutoff).toBeCloseTo(2800, 3);
    expect(other.delivery).toBeCloseTo(320, 3);
    expect(other.efficiency).toBeCloseTo(0.7, 6);
  });
});
