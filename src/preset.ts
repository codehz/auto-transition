import { effects, type EnterEffect, type ExitEffect, type MoveEffect } from "./effects.ts";
import { createExitLayoutEffect, defineTransition } from "./transitionPresets.ts";
import type {
  EnterTransitionContext,
  ExitTransitionContext,
  MoveTransitionContext,
  TransitionEffect,
  TransitionPhaseDefinition,
  TransitionPlugin,
  TransitionTiming,
} from "./transitionTypes.ts";

type PhaseName = "enter" | "exit" | "move";

type OneOrMany<T> = T | T[];

type EffectWithPhase = {
  debugName?: string;
  phases?: readonly PhaseName[];
};

export type PresetSpec = {
  enter?: OneOrMany<EnterEffect>;
  exit?: OneOrMany<ExitEffect>;
  move?: MoveEffect;
  timing?: {
    enter?: TransitionTiming<EnterTransitionContext>;
    exit?: TransitionTiming<ExitTransitionContext>;
    move?: TransitionTiming<MoveTransitionContext>;
  };
};

function toArray<T>(value: OneOrMany<T> | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function validateEffectPhase(effect: EffectWithPhase, phase: PhaseName) {
  if (!effect.phases || effect.phases.includes(phase)) {
    return;
  }

  if (effect.phases.length === 1) {
    throw new Error(`${effect.debugName ?? "effect()"} can only be used in ${effect.phases[0]}`);
  }

  throw new Error(`${effect.debugName ?? "effect()"} cannot be used in ${phase}`);
}

function createEnterPhase(
  effectList: EnterEffect[],
  options?: TransitionTiming<EnterTransitionContext>,
): TransitionPhaseDefinition<EnterTransitionContext> | undefined {
  if (effectList.length === 0) {
    return undefined;
  }

  effectList.forEach((effect) => validateEffectPhase(effect, "enter"));
  return {
    effects: effectList as unknown as TransitionEffect<EnterTransitionContext>[],
    options,
  };
}

function createExitPhase(
  effectList: ExitEffect[],
  options?: TransitionTiming<ExitTransitionContext>,
): TransitionPhaseDefinition<ExitTransitionContext> | undefined {
  if (effectList.length === 0) {
    return undefined;
  }

  effectList.forEach((effect) => validateEffectPhase(effect, "exit"));
  return {
    effects: [createExitLayoutEffect(), ...(effectList as unknown as TransitionEffect<ExitTransitionContext>[])],
    options,
  };
}

function createMovePhase(
  effect: MoveEffect | undefined,
  options?: TransitionTiming<MoveTransitionContext>,
): TransitionPhaseDefinition<MoveTransitionContext> | undefined {
  if (!effect) {
    return undefined;
  }

  validateEffectPhase(effect, "move");
  return {
    effects: [effect as TransitionEffect<MoveTransitionContext>],
    options,
  };
}

export function preset(spec: PresetSpec): TransitionPlugin {
  return {
    enter: createEnterPhase(toArray(spec.enter), spec.timing?.enter),
    exit: createExitPhase(toArray(spec.exit), spec.timing?.exit),
    move: createMovePhase(spec.move, spec.timing?.move),
  };
}

const defaultTransition = defineTransition(
  preset({
    enter: effects.fade(0),
    move: effects.flip(),
    timing: {
      enter: { duration: 250, easing: "ease-out" },
      move: { duration: 250, easing: "ease-in" },
    },
  }),
);

const defaultExit = defineTransition(
  preset({
    exit: effects.fade(0),
    timing: {
      exit: { duration: 250, easing: "ease-in" },
    },
  }),
);

export function defaultEnterTransition(ctx: EnterTransitionContext): Animation {
  return defaultTransition.enter!(ctx);
}

export function defaultExitTransition(ctx: ExitTransitionContext): Animation {
  return defaultExit.exit!(ctx);
}

export function defaultMoveTransition(ctx: MoveTransitionContext): Animation {
  return defaultTransition.move!(ctx);
}

export { effects };
