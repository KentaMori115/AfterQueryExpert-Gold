/**
 * What a winding engineer would say after a week at the pit.
 *
 * The design checks say whether an installation meets its figures. This
 * says what is wrong with it, which is a different question and usually
 * the more useful one. A winder can be inside every band in the design
 * and still be badly arranged: a rope too stiff for its drum, a drum
 * too far from its sheave, a sump too shallow for the speed being wound
 * at, or a standing time so long that the winder's speed is irrelevant
 * to the output.
 *
 * The findings are ordered the way the load travels — the rope, the
 * drum or wheel, the conveyances, the shaft, the cycle, the engine, and
 * the safety gear — because that is the order in which a fault in one
 * shows up as a mystery in the next.
 */

import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import {
  LEAST_RATIO,
  bendingStress,
  breakingLoad,
  condemningBreaks,
  factorFor,
  leastDrum,
  lifeIn,
  massPerMetre,
  outerWire,
  ratioOf,
  staticRopeLoad,
} from "../rope/index.ts";
import {
  MOST_FLEET,
  bigEnoughFor,
  capacity,
  crushing,
  fleetAngle,
  layersFor,
  leadFor,
  liesDown,
  speedCreep,
} from "../drum/cylindrical.ts";
import { balancedTensions, liningPressure, liningStands, willDrive, workingRatio, worstRatio } from "../drum/koepe.ts";
import { gross, matched, menIn, menLimitedBy, usefulFraction } from "../cage/index.ts";
import { BRISK_AIR, ropeLength, sumpEnough, sumpFor, overwindRoom, stoppableFrom, widestConveyance, willFit } from "../shaft/index.ts";
import { MEN_SPEED, atFullShare, movingShare, reachesFull, worthOfASecond, worthOfSpeed } from "../cycle/index.ts";
import { hookBand, retardationFor, EMERGENCY_BRAKE } from "../safety/index.ts";
import {
  type Winder,
  balanceSwing,
  cycleLasts,
  deadShare,
  drumOf,
  dutyOf,
  energyATonne,
  factor,
  factorWanted,
  hangingLoad,
  motor,
  outputPerDay,
  peak,
  rms,
  ropeStrongEnough,
  ropeWanted,
  wheelOf,
  windLength,
} from "./model.ts";
import { balanceWanted, overloadRatio } from "../power/index.ts";

/** How much a finding matters. */
export type Severity = "note" | "warning" | "error";

/** Something the installation shows. */
export interface Finding {
  /** How much it matters. */
  readonly severity: Severity;
  /** Which part of the installation it is about. */
  readonly part: string;
  /** What was found. */
  readonly message: string;
}

function finding(severity: Severity, part: string, message: string): Finding {
  return { severity, part, message };
}

/** What the rope shows. */
export function ropeFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  if (!ropeStrongEnough(one)) {
    out.push(
      finding(
        "error",
        "rope",
        `the rope is working at ${factor(one)} where a ${windLength(one)} m shaft demands ${factorWanted(one)}: that is not a rope for this shaft`,
      ),
    );
  }
  const own = staticRopeLoad(one.rope, windLength(one)) * one.ropes;
  const share = own / hangingLoad(one);
  if (share > 0.4) {
    out.push(
      finding(
        "warning",
        "rope",
        `${round(share * 100, 1)} per cent of what this rope lifts is the rope: below about half a shaft is wound in two stages instead`,
      ),
    );
  }
  out.push(
    finding(
      "note",
      "rope",
      `${one.rope.diameter} mm ${one.rope.construction.name} at ${one.rope.grade}: ${breakingLoad(one.rope)} kN, ` +
        `${massPerMetre(one.rope)} kg/m, condemned at ${condemningBreaks(one.rope)} broken wires in a lay`,
    ),
  );
  return out;
}

/** What the drum or the friction wheel shows. */
export function driveFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  if (one.drive.kind === "drum") {
    const barrel = drumOf(one);
    if (!bigEnoughFor(barrel, one.rope)) {
      out.push(
        finding(
          "error",
          "drum",
          `a ${barrel.diameter} m drum on a ${one.rope.diameter} mm rope is ${ratioOf(one.rope, barrel.diameter)} to one where ` +
            `${LEAST_RATIO} is the least: the rope wants ${leastDrum(one.rope)} m and will fail from the inside on this one`,
        ),
      );
    }
    if (!liesDown(barrel)) {
      out.push(
        finding(
          "error",
          "drum",
          `a fleet angle of ${fleetAngle(barrel)}° is past ${MOST_FLEET}°: the rope rides up on the turn beside it and drops, ` +
            `and the cure is a lead of ${leadFor(barrel)} m rather than ${barrel.lead}`,
        ),
      );
    }
    if (capacity(barrel, one.rope) < ropeWanted(one)) {
      out.push(
        finding(
          "error",
          "drum",
          `that drum holds ${capacity(barrel, one.rope)} m of rope and the wind wants ${ropeWanted(one)}`,
        ),
      );
    } else if (barrel.layers > layersFor(barrel, one.rope, ropeWanted(one))) {
      out.push(
        finding(
          "note",
          "drum",
          `the rope goes on in ${layersFor(barrel, one.rope, ropeWanted(one))} layers where the drum was built for ${barrel.layers}`,
        ),
      );
    }
    if (barrel.layers > 2) {
      out.push(
        finding(
          "warning",
          "drum",
          `${barrel.layers} layers put ${crushing(barrel)} times the rope tension on the bottom coil, and flatten it where nobody can see it`,
        ),
      );
    }
    out.push(
      finding(
        "note",
        "drum",
        `${round(bendingStress(one.rope, barrel.diameter), 0)} N/mm² of bending in a ${outerWire(one.rope)} mm outer wire; ` +
          `${lifeIn(one.rope, barrel.diameter)} winds of life; speed creeps ${round(speedCreep(barrel, one.rope) * 100, 1)}% across the layers`,
      ),
    );
  } else {
    const wheel = wheelOf(one);
    // The whole set of ropes and the balance rope together, because it
    // is their sum that hangs beneath the wheel.
    const tensions = balancedTensions(one.rope, windLength(one), weightOf(gross(one.rising)), weightOf(gross(one.falling)), one.ropes);
    const worst = worstRatio(
      one.rope,
      windLength(one),
      weightOf(gross(one.rising)),
      weightOf(gross(one.falling)),
      100,
      one.ropes,
      one.balance,
    );
    if (worst > workingRatio(wheel)) {
      out.push(
        finding(
          "error",
          "koepe",
          `the tensions reach ${worst} to one where the lining holds ${workingRatio(wheel)}: it will slip and burn`,
        ),
      );
    }
    if (!liningStands(wheel, one.rope, tensions.taut, tensions.slack)) {
      out.push(
        finding("error", "koepe", `${liningPressure(wheel, one.rope, tensions.taut, tensions.slack)} N/mm² is more than a lining stands`),
      );
    }
    out.push(
      finding(
        "note",
        "koepe",
        `${wheel.ropes} ropes over a ${wheel.diameter} m wheel, worst ratio ` +
          `${worstRatio(one.rope, windLength(one), weightOf(gross(one.rising)), weightOf(gross(one.falling)), 100, one.ropes, one.balance)}`,
      ),
    );
  }
  return out;
}

/** What the conveyances show. */
export function conveyanceFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  if (!matched(one.rising, one.falling)) {
    out.push(
      finding(
        "warning",
        "conveyance",
        `the two conveyances are ${round(one.rising.tare / 1000, 2)} t and ${round(one.falling.tare / 1000, 2)} t: ` +
          `the difference is out-of-balance the winder carries on every wind of every shift`,
      ),
    );
  }
  if (usefulFraction(one.rising) < 0.4) {
    out.push(
      finding(
        "warning",
        "conveyance",
        `only ${round(usefulFraction(one.rising) * 100, 1)} per cent of what is hoisted is paid for; a skip installation reaches seventy`,
      ),
    );
  }
  if (one.rising.kind === "cage") {
    out.push(
      finding(
        "note",
        "conveyance",
        `${menIn(one.rising)} men a wind, limited by the ${menLimitedBy(one.rising)}`,
      ),
    );
  }
  out.push(
    finding("note", "conveyance", `${round(deadShare(one) * 100, 1)} per cent of what the rope lifts is not coal`),
  );
  return out;
}

/** What the shaft shows. */
export function shaftFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  if (!willFit(one.shaft, one.rising.width)) {
    out.push(
      finding(
        "error",
        "shaft",
        `${one.shaft.conveyances} conveyances ${one.rising.width} m wide will not go down a ${one.shaft.diameter} m shaft: ` +
          `the widest it takes is ${widestConveyance(one.shaft)} m`,
      ),
    );
  }
  if (!sumpEnough(one.shaft, one.profile.full)) {
    out.push(
      finding(
        "error",
        "shaft",
        `a ${one.shaft.sump} m sump will not stop an underwind at ${one.profile.full} m/s, which wants ${sumpFor(one.profile.full)} m`,
      ),
    );
  }
  const stoppable = stoppableFrom(one.shaft);
  if (stoppable < one.profile.full) {
    out.push(
      finding(
        "error",
        "shaft",
        `the headgear leaves ${overwindRoom(one.shaft)} m above the bank, which arrests ${stoppable} m/s against a winding speed of ${one.profile.full}`,
      ),
    );
  }
  out.push(
    finding(
      "note",
      "shaft",
      `${windLength(one)} m of wind and ${ropeWanted(one)} m of rope; air is brisk above ${BRISK_AIR} m/s`,
    ),
  );
  return out;
}

/** What the cycle shows. */
export function cycleFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  if (!reachesFull(one.profile, windLength(one))) {
    out.push(
      finding(
        "warning",
        "cycle",
        `this shaft is too short for ${one.profile.full} m/s: the wind never reaches it, so the winder's speed is worth nothing`,
      ),
    );
  }
  const second = worthOfASecond(one.profile, windLength(one), one.rising.payload);
  const metre = worthOfSpeed(one.profile, windLength(one), one.rising.payload);
  if (second > metre) {
    out.push(
      finding(
        "warning",
        "cycle",
        `a second off the ${one.profile.rest} s standing time is worth ${second} t/h and a metre a second on the winder is worth ${metre}: ` +
          `the money is at the pit top and not in the engine house`,
      ),
    );
  }
  if (one.profile.full > MEN_SPEED) {
    out.push(
      finding(
        "note",
        "cycle",
        `men may not be wound above ${MEN_SPEED} m/s, so man-winding is a slower cycle than the coal one`,
      ),
    );
  }
  out.push(
    finding(
      "note",
      "cycle",
      `${cycleLasts(one)} s a cycle, ${round(movingShare(one.profile, windLength(one)) * 100, 1)}% of it moving, ` +
        `${round(atFullShare(one.profile, windLength(one)) * 100, 1)}% at full speed`,
    ),
  );
  return out;
}

/** What the engine shows. */
export function engineFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  const ratio = overloadRatio(dutyOf(one), one.profile);
  if (ratio > 2.5) {
    out.push(
      finding(
        "warning",
        "engine",
        `the peak is ${ratio} times the r.m.s.: a drive has to carry that overload for the whole of every acceleration`,
      ),
    );
  }
  const wantedBalance = balanceWanted(dutyOf(one));
  if (balanceSwing(one) > 20 && one.balance < wantedBalance * 0.5) {
    out.push(
      finding(
        "warning",
        "engine",
        `the out-of-balance swings ${balanceSwing(one)} kN across a wind because there is no balance rope; ` +
          `${round(wantedBalance, 2)} kg/m would take it out`,
      ),
    );
  }
  out.push(
    finding(
      "note",
      "engine",
      `${peak(one)} kW peak, ${rms(one)} kW r.m.s., ${motor(one)} kW of motor, ${energyATonne(one)} kWh a tonne raised`,
    ),
  );
  return out;
}

/** What the safety gear shows. */
export function safetyFindings(one: Winder): Finding[] {
  const out: Finding[] = [];
  const room = overwindRoom(one.shaft);
  const wanted = retardationFor(one.profile.full, room);
  if (wanted > EMERGENCY_BRAKE * 2) {
    out.push(
      finding(
        "warning",
        "safety",
        `stopping an overwind in ${room} m from ${one.profile.full} m/s wants ${wanted} m/s², which is arrestor gear and not a brake`,
      ),
    );
  }
  const band = hookBand(breakingLoad(one.rope) * one.ropes, hangingLoad(one));
  out.push(
    finding(
      "note",
      "safety",
      `the detaching hook sits between ${band.low} and ${band.high} kN, and the rope is condemned at ` +
        `${condemningBreaks(one.rope)} broken wires in a lay length`,
    ),
  );
  return out;
}

/** Everything, in the order the load travels. */
export function auditWinder(one: Winder): Finding[] {
  return [
    ...ropeFindings(one),
    ...driveFindings(one),
    ...conveyanceFindings(one),
    ...shaftFindings(one),
    ...cycleFindings(one),
    ...engineFindings(one),
    ...safetyFindings(one),
  ];
}

/** Only the findings that stop the installation being worked. */
export function errors(found: readonly Finding[]): Finding[] {
  return found.filter((each) => each.severity === "error");
}

/** Whether the installation passes without an error against it. */
export function passes(one: Winder): boolean {
  return errors(auditWinder(one)).length === 0;
}

/** How many of each severity were found. */
export function counted(found: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { note: 0, warning: 0, error: 0 };
  for (const each of found) out[each.severity] += 1;
  return out;
}

/** The output the installation actually makes, for the head of a report. */
export function summary(one: Winder): string {
  return `${one.name}: ${outputPerDay(one)} t/d, ${factor(one)} on the rope, ${motor(one)} kW of motor`;
}
