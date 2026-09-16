import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const scripts = ["questions.js", "backgrounds.js", "music.js", "app.js"]
  .map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

describe("background music", () => {
  let dom;
  let context;
  let sources;
  let gains;

  beforeEach(() => {
    sources = [];
    gains = [];
    dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.scrollTo = vi.fn();
    dom.window.confirm = () => true;
    dom.window.AudioContext = class {
      constructor() {
        this.sampleRate = 8000;
        this.currentTime = 0;
        this.state = "suspended";
        this.destination = {};
        context = this;
      }
      async resume() { this.state = "running"; }
      createBuffer(channels, length, sampleRate) {
        const data = new Float32Array(length);
        return { duration: length / sampleRate, getChannelData: () => data };
      }
      createBufferSource() {
        const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        sources.push(source);
        return source;
      }
      createGain() {
        const gain = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            cancelAndHoldAtTime: vi.fn(),
          },
        };
        gains.push(gain);
        return gain;
      }
    };
    dom.window.eval(`${scripts}\nwindow.testMusic = music;`);
  });

  afterEach(() => {
    dom.window.close();
    vi.restoreAllMocks();
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it("waits for interaction, then plays a quiet, seamless menu loop", async () => {
    expect(sources).toHaveLength(0);
    dom.window.document.getElementById("add-team").click();
    await settle();
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.12, 1.2);
    const data = sources[0].buffer.getChannelData(0);
    let peak = 0;
    for (const value of data) {
      expect(Number.isFinite(value)).toBe(true);
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1);
    expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThan(0.01);
  });

  it("crossfades to a distinct game loop and back without restarting on each question", async () => {
    dom.window.document.getElementById("setup-form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    dom.window.document.body.click();
    await settle();
    const gameBuffer = sources[0].buffer;
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.18, 1.2);
    dom.window.document.querySelector(".answer").click();
    dom.window.document.getElementById("next-question").click();
    expect(sources).toHaveLength(1);
    dom.window.document.getElementById("leave-game").click();
    expect(sources).toHaveLength(2);
    expect(sources[0].stop).toHaveBeenCalledWith(0.6);
    expect(sources[1].buffer).not.toBe(gameBuffer);
    expect(sources[1].buffer.duration).toBeGreaterThan(gameBuffer.duration);
    expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.12, 1.2);
    sources[0].onended();
    expect(sources[0].disconnect).toHaveBeenCalled();
    expect(gains[0].disconnect).toHaveBeenCalled();
  });

  it("can be muted before activation and stays muted across screens", async () => {
    const toggle = dom.window.document.getElementById("music-toggle");
    toggle.click();
    dom.window.document.body.click();
    await settle();
    expect(sources).toHaveLength(0);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    await settle();
    expect(sources).toHaveLength(1);
    toggle.click();
    dom.window.testMusic.setScene("game");
    expect(sources).toHaveLength(1);
    expect(sources[0].stop).toHaveBeenCalled();
    toggle.click();
    await settle();
    expect(sources).toHaveLength(2);
    expect(dom.window.testMusic.track.scene).toBe("game");
  });

  it("pauses in a hidden tab and resumes the current scene", async () => {
    dom.window.document.body.click();
    await settle();
    const hidden = vi.spyOn(dom.window.document, "hidden", "get").mockReturnValue(true);
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    expect(sources[0].stop).toHaveBeenCalled();
    dom.window.testMusic.setScene("game");
    expect(sources).toHaveLength(1);
    hidden.mockReturnValue(false);
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    await settle();
    expect(dom.window.testMusic.track.scene).toBe("game");
    expect(sources).toHaveLength(2);
  });

  it("returns to menu music on results and game music on replay", async () => {
    dom.window.document.getElementById("setup-form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    dom.window.document.body.click();
    await settle();
    while (dom.window.document.getElementById("results-screen").hidden) {
      dom.window.document.querySelector(".answer").click();
      dom.window.document.getElementById("next-question").click();
    }
    expect(dom.window.testMusic.track.scene).toBe("menu");
    dom.window.document.getElementById("play-again").click();
    expect(dom.window.testMusic.track.scene).toBe("game");
    expect(sources).toHaveLength(3);
    expect(sources[2].buffer).toBe(sources[0].buffer);
  });

  it("surfaces playback errors and allows retry without breaking the game", async () => {
    dom.window.document.body.click();
    await settle();
    vi.spyOn(dom.window.console, "error").mockImplementation(() => {});
    vi.spyOn(context, "resume").mockRejectedValueOnce(new Error("Audio unavailable"));
    const toggle = dom.window.document.getElementById("music-toggle");
    toggle.click();
    toggle.click();
    await settle();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(dom.window.document.getElementById("music-status").textContent)
      .toContain("Не удалось включить музыку");
    toggle.click();
    await settle();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(dom.window.document.getElementById("music-status").textContent).toBe("");
  });

  it("keeps the quiz usable when Web Audio is unavailable", () => {
    dom.window.close();
    dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(scripts);
    expect(dom.window.document.getElementById("music-toggle").disabled).toBe(true);
    expect(dom.window.document.getElementById("music-status").textContent).not.toBe("");
    dom.window.document.getElementById("add-team").click();
    expect(dom.window.document.querySelectorAll(".team-field")).toHaveLength(3);
  });
});
