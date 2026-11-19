import { createSocket } from 'node:dgram'
import { readFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { connect } from 'node:tls'

const CONFIG_PATH = '/run/workcell-relay/config.json'
const DNS_PORT = 53
const HTTPS_PORT = 443
const DNS_HEADER_BYTES = 12
const DNS_QUESTION_TAIL_BYTES = 5
const DNS_TYPE_OFFSET_FROM_QUESTION_END = 4
const DNS_ANSWER_BYTES = 16
const DNS_RESPONSE_FLAGS = 33_152
const DNS_NAME_POINTER_TO_QUESTION = 49_164
const DNS_TYPE_A = 1
const DNS_CLASS_IN = 1
const DNS_TTL_SECONDS = 60
const IPV4_BYTES = 4
const DNS_ANSWER_COUNT_OFFSET = 6
const DNS_QUESTION_COUNT_OFFSET = 4
const DNS_FLAGS_OFFSET = 2
const ANSWER_TYPE_OFFSET = 2
const ANSWER_CLASS_OFFSET = 4
const ANSWER_TTL_OFFSET = 6
const ANSWER_LENGTH_OFFSET = 10
const ANSWER_ADDRESS_OFFSET = 12

type RelayConfig = {
  sandboxAddress: string
  proxyHost: string
  proxyPort: number
  serverName: string
  authority: string
  certificate: string
  privateKey: string
}

function readConfig(): RelayConfig {
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('sandboxAddress' in parsed) ||
    typeof parsed.sandboxAddress !== 'string' ||
    !('proxyHost' in parsed) ||
    typeof parsed.proxyHost !== 'string' ||
    !('proxyPort' in parsed) ||
    typeof parsed.proxyPort !== 'number' ||
    !('serverName' in parsed) ||
    typeof parsed.serverName !== 'string' ||
    !('authority' in parsed) ||
    typeof parsed.authority !== 'string' ||
    !('certificate' in parsed) ||
    typeof parsed.certificate !== 'string' ||
    !('privateKey' in parsed) ||
    typeof parsed.privateKey !== 'string'
  ) {
    throw new Error(`The relay config at ${CONFIG_PATH} is incomplete.`)
  }

  return {
    sandboxAddress: parsed.sandboxAddress,
    proxyHost: parsed.proxyHost,
    proxyPort: parsed.proxyPort,
    serverName: parsed.serverName,
    authority: parsed.authority,
    certificate: parsed.certificate,
    privateKey: parsed.privateKey
  }
}

function questionEnd(query: Buffer) {
  let offset = DNS_HEADER_BYTES

  while (offset < query.length && query[offset] !== 0) {
    offset += (query[offset] ?? 0) + 1
  }

  return offset + DNS_QUESTION_TAIL_BYTES
}

function addressRecord(address: string) {
  const record = Buffer.alloc(DNS_ANSWER_BYTES)
  record.writeUInt16BE(DNS_NAME_POINTER_TO_QUESTION, 0)
  record.writeUInt16BE(DNS_TYPE_A, ANSWER_TYPE_OFFSET)
  record.writeUInt16BE(DNS_CLASS_IN, ANSWER_CLASS_OFFSET)
  record.writeUInt32BE(DNS_TTL_SECONDS, ANSWER_TTL_OFFSET)
  record.writeUInt16BE(IPV4_BYTES, ANSWER_LENGTH_OFFSET)
  for (const [index, part] of address.split('.').entries()) {
    record.writeUInt8(Number(part), ANSWER_ADDRESS_OFFSET + index)
  }

  return record
}

function answerQuery(query: Buffer, address: string) {
  const end = questionEnd(query)

  if (end > query.length || end < DNS_TYPE_OFFSET_FROM_QUESTION_END) {
    return null
  }

  const isAddressQuery =
    query.readUInt16BE(end - DNS_TYPE_OFFSET_FROM_QUESTION_END) === DNS_TYPE_A
  const header = Buffer.alloc(DNS_HEADER_BYTES)
  query.copy(header, 0, 0, DNS_FLAGS_OFFSET)
  header.writeUInt16BE(DNS_RESPONSE_FLAGS, DNS_FLAGS_OFFSET)
  header.writeUInt16BE(1, DNS_QUESTION_COUNT_OFFSET)
  header.writeUInt16BE(isAddressQuery ? 1 : 0, DNS_ANSWER_COUNT_OFFSET)
  const question = query.subarray(DNS_HEADER_BYTES, end)

  return Buffer.concat(
    isAddressQuery
      ? [header, question, addressRecord(address)]
      : [header, question]
  )
}

function readConfigOrNull() {
  try {
    return readConfig()
  } catch {
    return null
  }
}

function relayToProxy(socket: Socket) {
  const config = readConfigOrNull()

  if (config === null) {
    socket.destroy()

    return
  }

  const proxy = connect({
    host: config.proxyHost,
    port: config.proxyPort,
    servername: config.serverName,
    ca: config.authority,
    cert: config.certificate,
    key: config.privateKey
  })
  proxy.on('error', () => {
    socket.destroy()
  })
  socket.on('error', () => {
    proxy.destroy()
  })
  socket.pipe(proxy).pipe(socket)
}

const dns = createSocket('udp4')
dns.on('message', (query, sender) => {
  const config = readConfigOrNull()

  if (config === null || query.length < DNS_HEADER_BYTES) {
    return
  }

  const answer = answerQuery(query, config.sandboxAddress)

  if (answer !== null) {
    dns.send(answer, sender.port, sender.address)
  }
})
dns.bind(DNS_PORT)
createServer(relayToProxy).listen(HTTPS_PORT)
