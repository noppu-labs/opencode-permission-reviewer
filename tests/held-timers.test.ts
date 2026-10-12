import { afterEach, expect, mock, test } from "bun:test";
import { holdOneSecondTimers, runEach } from "./held-timers.ts";

let timers: ReturnType<typeof holdOneSecondTimers> | undefined;
afterEach(() => {
  timers?.restore();
  timers = undefined;
});

test("runEach runs every callback when one throws, then rethrows", () => {
  const after = mock(() => {});
  expect(() =>
    runEach([
      (): void => {
        throw new Error("cleanup failed");
      },
      after,
    ]),
  ).toThrow("cleanup failed");
  expect(after).toHaveBeenCalledTimes(1);
});

test("a throwing cleanup before the restore still releases the timer hold", () => {
  const hold = holdOneSecondTimers();
  expect(() =>
    runEach([
      (): void => {
        throw new Error("destroy failed");
      },
      hold.restore,
    ]),
  ).toThrow("destroy failed");
  timers = holdOneSecondTimers();
});

test("fire runs every held timer when one throws", () => {
  timers = holdOneSecondTimers();
  const second = mock(() => {});
  setTimeout(() => {
    throw new Error("held timer failed");
  }, 1000);
  setTimeout(second, 1000);
  expect(() => timers?.fire()).toThrow("held timer failed");
  expect(second).toHaveBeenCalledTimes(1);
  expect(timers.pending).toBe(0);
});

test("held and passed-through timers keep their arguments and Timer handle", async () => {
  timers = holdOneSecondTimers();
  const passed = await new Promise((resolve) => setTimeout(resolve, 1, "arg"));
  expect(passed).toBe("arg");
  const held = mock((_value: string) => {});
  const handle = setTimeout(held, 1000, "late");
  expect(typeof handle.unref).toBe("function");
  timers.fire();
  expect(held).toHaveBeenCalledWith("late");
  const cancelled = mock(() => {});
  clearTimeout(setTimeout(cancelled, 1000));
  timers.fire();
  expect(cancelled).not.toHaveBeenCalled();
});
