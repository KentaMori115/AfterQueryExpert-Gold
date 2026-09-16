import { annotateCommand } from "./commands/annotate.js";
import { checkCommand } from "./commands/check.js";
import { codesCommand } from "./commands/codes.js";
import { completionCommand } from "./commands/completion.js";
import { continuityCommand } from "./commands/continuity.js";
import { distanceCommand } from "./commands/distance.js";
import { inventoryCommand } from "./commands/inventory.js";
import { crowdCommand } from "./commands/crowd.js";
import { diffCommand } from "./commands/diff.js";
import { doubleCommand } from "./commands/double.js";
import { explainCommand } from "./commands/explain.js";
import { hazardCommand } from "./commands/hazard.js";
import { formatCommand, lintCommand } from "./commands/lint.js";
import { labelCommand } from "./commands/label.js";
import { layoutCommand, planCommand } from "./commands/plan.js";
import { packCommand } from "./commands/pack.js";
import { permitCommand } from "./commands/permit.js";
import { previewCommand } from "./commands/preview.js";
import { sheetCommand } from "./commands/sheet.js";
import { rehearseCommand } from "./commands/rehearse.js";
import { tableCommand } from "./commands/table.js";
import { versionCommand } from "./commands/version.js";
import { CommandSet } from "./command.js";

/** Every command portfire knows, built once. */
export function buildCommands(): CommandSet {
  return new CommandSet()
    .add(annotateCommand)
    .add(checkCommand)
    .add(codesCommand)
    .add(completionCommand)
    .add(continuityCommand)
    .add(distanceCommand)
    .add(crowdCommand)
    .add(diffCommand)
    .add(doubleCommand)
    .add(explainCommand)
    .add(hazardCommand)
    .add(formatCommand)
    .add(inventoryCommand)
    .add(lintCommand)
    .add(labelCommand)
    .add(layoutCommand)
    .add(packCommand)
    .add(permitCommand)
    .add(planCommand)
    .add(previewCommand)
    .add(sheetCommand)
    .add(rehearseCommand)
    .add(tableCommand)
    .add(versionCommand);
}
