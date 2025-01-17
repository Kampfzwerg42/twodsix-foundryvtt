// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck This turns off *all* typechecking, make sure to remove this once foundry-vtt-types are updated to cover v10.

import { Component, Skills } from "src/types/template";
import { AvailableShipActionData, AvailableShipActions, ExtraData } from "../../types/twodsix";
import { TWODSIX } from "../config";
import TwodsixItem from "../entities/TwodsixItem";
import { getKeyByValue } from "./sheetUtils";
import { TwodsixRollSettings } from "./TwodsixRollSettings";
import { DICE_ROLL_MODES } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/constants.mjs";

export class TwodsixShipActions {
  public static availableMethods = <AvailableShipActions>{
    [TWODSIX.SHIP_ACTION_TYPE.chatMessage]: <AvailableShipActionData>{
      action: TwodsixShipActions.chatMessage,
      name: "Chat",
      placeholder: "Message",
      tooltip: ""
    },
    [TWODSIX.SHIP_ACTION_TYPE.skillRoll]: <AvailableShipActionData>{
      action: TwodsixShipActions.skillRoll,
      name: "Skill Roll",
      placeholder: "Skill/CHR 8+",
      tooltip: "Possible options:\nSkill\nSkill|Alternative Skill 1|...\nSkills/ATR\nSkills/ 8+\nSkills/ATR 8+"
    },
    [TWODSIX.SHIP_ACTION_TYPE.fireEnergyWeapons]: <AvailableShipActionData>{
      action: TwodsixShipActions.fireEnergyWeapons,
      name: "Use a component",
      placeholder: "Skill/CHR 8+=COMPONENT_ID",
      tooltip: "Possible options:\nSkill=COMPONENT_ID\nSkill|Alternative Skill 1|...=COMPONENT_ID\nSkills/ATR=COMPONENT_ID\nSkills/ 8+=COMPONENT_ID\nSkills/ATR 8+=COMPONENT_ID"
    }
  };

  public static async chatMessage(msg: string, extra: ExtraData) {
    const speakerData = ChatMessage.getSpeaker({ actor: extra.actor });
    if (msg.startsWith("/r") || msg.startsWith("/R")) {
      let rollText = msg.substring(msg.indexOf(' ') + 1); /* return roll formula after first space */
      const useInvertedShiftClick: boolean = (<boolean>game.settings.get('twodsix', 'invertSkillRollShiftClick'));
      const showRollDiag = useInvertedShiftClick ? extra.event["shiftKey"] : !extra.event["shiftKey"];
      if(showRollDiag) {
        rollText = await TwodsixItem.confirmRollFormula(rollText, (extra.positionName + " " + game.i18n.localize("TWODSIX.Ship.ActionRollFormula")));
      }
      if (Roll.validate(rollText)) {
        const rollData = extra.actor?.getRollData();
        const flavorTxt:string = game.i18n.localize("TWODSIX.Ship.MakesChatRollAction").replace( "_ACTION_NAME_", extra.actionName || game.i18n.localize("TWODSIX.Ship.Unknown")).replace("_POSITION_NAME_", (extra.positionName || game.i18n.localize("TWODSIX.Ship.Unknown")));
        return new Roll(rollText, rollData).toMessage({speaker: speakerData, flavor: flavorTxt});
      }
    }
    return ChatMessage.create({ content: msg, speaker: speakerData });
  }

  public static async skillRoll(text: string, extra: ExtraData) {
    const useInvertedShiftClick: boolean = (<boolean>game.settings.get('twodsix', 'invertSkillRollShiftClick'));
    const showTrowDiag = useInvertedShiftClick ? extra.event["shiftKey"] : !extra.event["shiftKey"];
    const difficulties = TWODSIX.DIFFICULTIES[(<number>game.settings.get('twodsix', 'difficultyListUsed'))];
    const re = new RegExp(/^(.[^/]+)\/?([a-zA-Z]{0,3}) ?(\d{0,2})\+? ?=? ?(.*?)$/);
    const parsedResult: RegExpMatchArray | null = re.exec(text);

    if (parsedResult !== null) {
      const [, parsedSkills, char, diff] = parsedResult;
      const skillOptions = parsedSkills.split("|");
      let skill = "";
      for (const skillOption in skillOptions) {
        skill = extra.actor?.itemTypes.skills.find((itm: TwodsixItem) => itm.name === skillOption) as TwodsixItem;
        if(skill){
          break;
        }
      }

      /*if skill missing, try to use Untrained*/
      if (!skill) {
        skill = (<TwodsixActor>extra.actor)?.itemTypes.skills.find((itm: TwodsixItem) => itm.name === game.i18n.localize("TWODSIX.Actor.Skills.Untrained")) as TwodsixItem;
        if (!skill) {
          ui.notifications.error(game.i18n.localize("TWODSIX.Ship.ActorLacksSkill").replace("_ACTOR_NAME_", extra.actor?.name ?? "").replace("_SKILL_", parsedSkills));
          return false;
        }
      }

      /*get characteristic key, default to skill key if none specificed in formula */
      let characteristicKey = "";
      if(!char) {
        characteristicKey = getKeyByValue(TWODSIX.CHARACTERISTICS, (<Skills>skill.system).characteristic);
      } else {
        characteristicKey = getCharacteristicFromDisplayLabel(char, extra.actor);
      }

      const charObject = extra.actor?.system["characteristics"];
      let shortLabel = "NONE";
      let displayLabel = "NONE";
      if (charObject && characteristicKey) {
        shortLabel = charObject[characteristicKey].shortLabel;
        displayLabel = charObject[characteristicKey].displayShortLabel;
      }
      const settings = {
        displayLabel: displayLabel,
        extraFlavor: game.i18n.localize("TWODSIX.Ship.MakesChatRollAction").replace( "_ACTION_NAME_", extra.actionName || game.i18n.localize("TWODSIX.Ship.Unknown")).replace("_POSITION_NAME_", (extra.positionName || game.i18n.localize("TWODSIX.Ship.Unknown"))),
        rollModifiers: {characteristic: shortLabel, item: extra.diceModifier ? parseInt(extra.diceModifier) : 0}
      };
      if (diff) {
        settings["difficulty"] = Object.values(difficulties).filter((difficulty: Record<string, number>) => difficulty.target === parseInt(diff, 10))[0];
      }
      const options = await TwodsixRollSettings.create(showTrowDiag, settings, skill, undefined, extra.actor);
      if (!options.shouldRoll) {
        return false;
      }
      return skill.skillRoll(showTrowDiag, options);

    } else {
      ui.notifications.error(game.i18n.localize("TWODSIX.Ship.CannotParseArgument"));
      return false;
    }
  }

  public static async fireEnergyWeapons(text: string, extra: ExtraData) {
    const [skilText, componentId] = text.split("=");
    const component = extra.ship?.items.find(item => item.id === componentId);
    if ((<Component>component?.system)?.rollModifier) {
      extra.diceModifier = (<Component>component?.system)?.rollModifier;
    }

    const result = await TwodsixShipActions.skillRoll(skilText, extra);
    if (!result) {
      return false;
    }

    const usingCompStr = component ? (game.i18n.localize("TWODSIX.Ship.WhileUsing") + component.name + ` `) : '';
    if (game.settings.get("twodsix", "automateDamageRollOnHit") && (<Component>component?.system)?.subtype === "armament") {
      if (result.effect >= 0 && component) {
        const bonusDamage = game.settings.get("twodsix", "addEffectForShipDamage") ? result.effect.toString() : "";
        await (<TwodsixItem>component).rollDamage((<DICE_ROLL_MODES>game.settings.get('core', 'rollMode')), bonusDamage, true, false);
      } else {
        TwodsixShipActions.chatMessage(game.i18n.localize("TWODSIX.Ship.ActionMisses").replace("_WHILE_USING_", usingCompStr).replace("_EFFECT_VALUE_", result.effect.toString()), extra);
      }
    }
  }
}

export function getCharacteristicFromDisplayLabel(char:string, actor?:TwodsixActor):string {
  let tempObject = {};
  let charObject= {};
  if (actor) {
    charObject = actor.system["characteristics"];
    for (const key in charObject) {
      tempObject[key] = charObject[key].displayShortLabel;
    }
  } else {
    tempObject = TWODSIX.CHARACTERISTICS;
  }

  return getKeyByValue(tempObject, char);
}
