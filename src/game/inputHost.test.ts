import { describe, expect, it, vi } from 'vitest';
import type { GameInput } from './input';
import { InputHost, nextTracker } from './inputHost';
import { parseSettings } from './settings';

/** A stand-in input whose start the test finishes by hand. */
function fakeInput() {
  let finishInit: () => void = () => {};
  let failInit: (error: unknown) => void = () => {};
  let reportFailure: (error: unknown) => void = () => {};
  const input = {
    mode: 'fake',
    delegate: 'fake',
    init: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finishInit = resolve;
          failInit = reject;
        }),
    ),
    start: vi.fn((_view: unknown, _onFrame: unknown, onError: (error: unknown) => void) => {
      reportFailure = onError;
    }),
    setMode: vi.fn(async () => {}),
    dispose: vi.fn(),
  } satisfies GameInput;
  return {
    input,
    finishInit: () => finishInit(),
    failInit: (error: unknown) => failInit(error),
    reportFailure: (error: unknown) => reportFailure(error),
  };
}

function setUp(query = '?input=bot') {
  const made: ReturnType<typeof fakeInput>[] = [];
  const create = vi.fn(() => {
    const fake = fakeInput();
    made.push(fake);
    return fake.input;
  });
  const onFailure = vi.fn();
  const options = parseSettings(null, query);
  const host = new InputHost(
    options,
    {} as HTMLElement,
    { view: vi.fn(), onFrame: vi.fn(), onFailure },
    create,
  );
  return { host, made, create, onFailure, options };
}

const handsFull = { mode: 'hands-full', faces: false } as const;
const splitWithFaces = { mode: 'hands-split', faces: true } as const;

describe('input host', () => {
  it('opens one input with the tracker and face models of the wish', async () => {
    const { host, made, create } = setUp();
    const wanted = host.want(splitWithFaces);
    made[0].finishInit();
    await wanted;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toEqual([expect.anything(), 'hands-split', true, expect.anything()]);
    expect(host.input).toBe(made[0].input);
    expect(made[0].input.start).toHaveBeenCalledTimes(1);
  });

  it('shares one opening between two wishes, and then switches to the newer tracker', async () => {
    const { host, made, create } = setUp();
    const first = host.want(handsFull);
    const second = host.want(splitWithFaces);
    made[0].finishInit();
    await Promise.all([first, second]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(made[0].input.setMode).toHaveBeenCalledTimes(1);
    expect(made[0].input.setMode).toHaveBeenCalledWith('hands-split', true);
  });

  it('closes an input that finished opening after the game stopped wanting one', async () => {
    const { host, made } = setUp();
    const wanted = host.want(splitWithFaces);
    await host.want(null);
    made[0].finishInit();
    await wanted;
    expect(made[0].input.dispose).toHaveBeenCalled();
    expect(made[0].input.start).not.toHaveBeenCalled();
    expect(host.input).toBeUndefined();
  });

  it('does not wait for a stale opening when the game wants an input again', async () => {
    const { host, made, create } = setUp();
    const stale = host.want(handsFull);
    await host.want(null);
    const fresh = host.want(handsFull);
    expect(create).toHaveBeenCalledTimes(2);

    made[1].finishInit();
    await fresh;
    expect(host.input).toBe(made[1].input);

    made[0].finishInit();
    await stale;
    expect(made[0].input.dispose).toHaveBeenCalled();
    expect(host.input).toBe(made[1].input);
  });

  it('does not hold a newer wish back while an older tracker still loads', async () => {
    const { host, made } = setUp();
    const opened = host.want(handsFull);
    made[0].finishInit();
    await opened;
    let finishSlowLoad: () => void = () => {};
    made[0].input.setMode.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSlowLoad = resolve)));
    const roundWish = host.want(splitWithFaces);
    await host.want(handsFull);
    expect(made[0].input.setMode).toHaveBeenLastCalledWith('hands-full', false);
    finishSlowLoad();
    await roundWish;
    expect(made[0].input.setMode).toHaveBeenCalledTimes(3);
  });

  it('keeps the error of an input that could not start', async () => {
    const { host, made } = setUp();
    const wanted = host.want(handsFull);
    const error = new Error('No camera');
    made[0].failInit(error);
    await wanted;
    expect(host.input).toBeUndefined();
    expect(host.error).toBe(error);
    expect(made[0].input.dispose).toHaveBeenCalled();
  });

  it('forgets the error of a stale opening', async () => {
    const { host, made } = setUp();
    const wanted = host.want(handsFull);
    await host.want(null);
    made[0].failInit(new Error('Prompt dismissed'));
    await wanted;
    expect(host.error).toBeUndefined();
  });

  it('closes the input and tells the game when tracking breaks', async () => {
    const { host, made, onFailure } = setUp();
    const wanted = host.want(handsFull);
    made[0].finishInit();
    await wanted;
    const error = new Error('Tracker crashed');
    made[0].reportFailure(error);
    expect(made[0].input.dispose).toHaveBeenCalled();
    expect(host.input).toBeUndefined();
    expect(host.error).toBe(error);
    expect(onFailure).toHaveBeenCalledWith(error);
  });

  it('keeps a tracker picked with the M key for later rounds', async () => {
    const { host, made } = setUp('?input=bot&players=2');
    expect(host.trackerMode()).toBe('hands-split');
    const wanted = host.want(splitWithFaces);
    made[0].finishInit();
    await wanted;
    await host.pickNextTracker(true);
    expect(made[0].input.setMode).toHaveBeenLastCalledWith('pose', true);
    expect(host.trackerMode()).toBe('pose');
  });

  it('takes the default tracker for the player count when none is picked', () => {
    expect(setUp('?players=1').host.trackerMode()).toBe('hands-full');
    expect(setUp('?players=2').host.trackerMode()).toBe('hands-split');
    expect(setUp('?players=1&tracker=pose').host.trackerMode()).toBe('pose');
  });
});

describe('tracker cycle', () => {
  it('steps through the trackers and round again', () => {
    expect(nextTracker('hands-full')).toBe('hands-split');
    expect(nextTracker('hands-split')).toBe('pose');
    expect(nextTracker('pose')).toBe('hands-full');
  });
});
