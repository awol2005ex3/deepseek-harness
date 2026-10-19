// @vitest-environment jsdom
/** The file route preflight and the browser save it authorises. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDownload } from '../src/client/face.ts'

const FILE = '/work/app/report.bin'

/** A HEAD answer the file route would send. */
function head(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createDownload', () => {
  it('preflights the authenticated file route and hands it to the browser when it answers ok', async () => {
    const preflight = vi.fn(() => Promise.resolve(head(200)))
    const save = vi.fn()
    const signal = new AbortController().signal
    const outcome = await createDownload(preflight, save)(FILE, 'report.bin', signal)
    expect(outcome).toEqual({ kind: 'started' })
    const url = new URL(preflight.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/api/file')
    expect(url.searchParams.get('path')).toBe(FILE)
    expect(preflight).toHaveBeenCalledWith(expect.any(String), { method: 'HEAD', signal })
    expect(save).toHaveBeenCalledWith(preflight.mock.calls[0]![0], 'report.bin')
  })

  it.each([
    [404, 'notFound'],
    [403, 'denied'],
    [413, 'tooLarge'],
    [500, 'unavailable'],
  ])('classifies a %s refusal as %s without saving', async (status, reason) => {
    const save = vi.fn()
    const outcome = await createDownload(() => Promise.resolve(head(status)), save)(FILE, 'report.bin', new AbortController().signal)
    expect(outcome).toEqual({ kind: 'failed', reason })
    expect(save).not.toHaveBeenCalled()
  })

  it('calls an unreachable route unavailable', async () => {
    const outcome = await createDownload(() => Promise.reject(new Error('connection lost')), vi.fn())(
      FILE, 'report.bin', new AbortController().signal,
    )
    expect(outcome).toEqual({ kind: 'failed', reason: 'unavailable' })
  })

  it('refuses to save a path the file route cannot address', async () => {
    const preflight = vi.fn(() => Promise.resolve(head(200)))
    const outcome = await createDownload(preflight, vi.fn())('report.bin', 'report.bin', new AbortController().signal)
    expect(outcome).toEqual({ kind: 'failed', reason: 'unavailable' })
    expect(preflight).not.toHaveBeenCalled()
  })

  it('saves through an anchor click by default', async () => {
    const click = vi.fn()
    const anchor = { href: '', download: '', click }
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)
    await createDownload(() => Promise.resolve(head(200)))(FILE, 'report.bin', new AbortController().signal)
    expect(anchor.href).toContain('/api/file?path=')
    expect(anchor.download).toBe('report.bin')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('preflights with the page fetch by default', async () => {
    const fetch = vi.fn(() => Promise.resolve(head(200)))
    vi.stubGlobal('fetch', fetch)
    const save = vi.fn()
    await createDownload(undefined, save)(FILE, 'report.bin', new AbortController().signal)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/file?path='), {
      method: 'HEAD', signal: expect.any(AbortSignal),
    })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
