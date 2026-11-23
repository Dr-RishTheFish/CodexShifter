(function (root) {
  class Shifter {
    constructor(models, mapping = {}) {
      this.models = models.filter((m) => !m.hidden);
      if (!this.models.length)
        throw Error("No models available. Check Codex sign-in.");
      this.defaultModel =
        this.models.find((m) => m.isDefault) || this.models[0];
      this.mapping = {};
      ["1", "2", "3", "4", "5"].forEach((g, i) => {
        this.mapping[g] =
          this.models.find((m) => m.model === mapping[g])?.model ||
          (this.models[i] || this.defaultModel).model;
      });
      this.gear = "N";
      this.locked = false;
      this.busy = false;
      this.active = null;
      this.selection = {
        model: this.defaultModel.model,
        effort: this.defaultModel.defaultReasoningEffort,
      };
    }
    get model() {
      return this.models.find((m) => m.model === this.selection.model);
    }
    get efforts() {
      return this.model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
    }
    shift(gear) {
      if (this.locked) return false;
      if (!["N", "R", "1", "2", "3", "4", "5"].includes(gear))
        throw Error("Unknown gear");
      this.gear = gear;
      this.selection.model = this.mapping[gear] || this.defaultModel.model;
      if (!this.efforts.includes(this.selection.effort))
        this.selection.effort = this.model.defaultReasoningEffort;
      return true;
    }
    setEffort(effort) {
      if (!this.efforts.includes(effort)) throw Error("unsupported effort");
      this.selection.effort = effort;
    }
    map(gear, model) {
      if (!this.models.some((m) => m.model === model))
        throw Error("Model unavailable");
      if (!Object.hasOwn(this.mapping, gear)) throw Error("Unknown gear");
      this.mapping[gear] = model;
      if (this.gear === gear) {
        const lock = this.locked;
        this.locked = false;
        this.shift(gear);
        this.locked = lock;
      }
    }
    begin(threadId, text) {
      if (this.busy) throw Error("Turn already running");
      if (!text.trim()) throw Error("Prompt is empty");
      if (!threadId) throw Error("Choose a session first");
      this.busy = true;
      this.active = { ...this.selection };
      return {
        threadId,
        model: this.active.model,
        effort: this.active.effort,
        input: [{ type: "text", text }],
      };
    }
    finish() {
      this.busy = false;
    }
  }
  function telemetry(usage) {
    return {
      total: usage?.total?.totalTokens ?? null,
      cached: usage?.total?.cachedInputTokens ?? null,
      contextRemaining: usage?.modelContextWindow
        ? Math.max(
            0,
            Math.min(
              100,
              100 -
                (100 *
                  ((usage.last?.inputTokens || 0) +
                    (usage.last?.outputTokens || 0))) /
                  usage.modelContextWindow,
            ),
          )
        : null,
    };
  }
  function outputRate(usage, elapsedSeconds) {
    const output = usage?.last?.outputTokens;
    return typeof output === "number"
      ? Math.max(0, Math.round((output / Math.max(1, elapsedSeconds)) * 60))
      : null;
  }
  const api = { Shifter, telemetry, outputRate };
  if (typeof module !== "undefined") module.exports = api;
  else root.ShifterCore = api;
})(globalThis);
