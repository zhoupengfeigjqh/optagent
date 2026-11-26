
import type { RawSseEvent } from '../api/types'

const DEFAULT_EVENT_NAME = 'message'

export function parseSseChunk(
  buffer: string,
  chunk: string,
): { events: RawSseEvent[]; rest: string } {
  const combined = buffer + chunk
  const blocks = combined.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''

  const events: RawSseEvent[] = []
  for (const block of blocks) {
    const event = parseBlock(block)
    if (event) {
      events.push(event)
    }
  }

  return { events, rest }
}

function parseBlock(block: string): RawSseEvent | null {
  if (block.trim() === '') {
    return null
  }

  let eventName = ''
  const dataLines: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) {
      continue
    }

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  if (eventName === '' && dataLines.length === 0) {
    return null
  }

  return {
    event: eventName === '' ? DEFAULT_EVENT_NAME : eventName,
    data: dataLines.join('\n'),
  }
}
