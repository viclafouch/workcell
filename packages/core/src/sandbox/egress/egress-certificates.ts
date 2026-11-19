import 'reflect-metadata'
import { randomBytes } from 'node:crypto'
import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  PemConverter,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509CertificateGenerator
} from '@peculiar/x509'

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }
const CLOCK_SKEW_MS = 3_600_000
const VALIDITY_MS = 31_536_000_000
const SERIAL_NUMBER_BYTES = 16

export type CertificateAuthority = {
  certificate: string
  name: string
  signingKey: CryptoKey
}

export type IssuedCertificate = {
  certificate: string
  privateKey: string
}

type IssueCertificateParams = {
  commonName: string
  dnsNames: readonly string[]
  usage: 'server' | 'client'
}

function validity() {
  const now = Date.now()

  return {
    notBefore: new Date(now - CLOCK_SKEW_MS),
    notAfter: new Date(now + VALIDITY_MS)
  }
}

function serialNumber() {
  return randomBytes(SERIAL_NUMBER_BYTES).toString('hex')
}

async function generateKeys(extractable: boolean) {
  return crypto.subtle.generateKey(ALGORITHM, extractable, ['sign', 'verify'])
}

export async function createCertificateAuthority(
  commonName: string
): Promise<CertificateAuthority> {
  const keys = await generateKeys(false)
  const name = `CN=${commonName}`
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: serialNumber(),
    name,
    keys,
    signingAlgorithm: ALGORITHM,
    ...validity(),
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
        true
      ),
      await SubjectKeyIdentifierExtension.create(keys.publicKey)
    ]
  })

  return {
    certificate: certificate.toString('pem'),
    name,
    signingKey: keys.privateKey
  }
}

export async function issueCertificate(
  authority: CertificateAuthority,
  { commonName, dnsNames, usage }: IssueCertificateParams
): Promise<IssuedCertificate> {
  const keys = await generateKeys(true)
  const certificate = await X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: `CN=${commonName}`,
    issuer: authority.name,
    publicKey: keys.publicKey,
    signingKey: authority.signingKey,
    signingAlgorithm: ALGORITHM,
    ...validity(),
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new ExtendedKeyUsageExtension([
        usage === 'server'
          ? ExtendedKeyUsage.serverAuth
          : ExtendedKeyUsage.clientAuth
      ]),
      new SubjectAlternativeNameExtension(
        dnsNames.map((value) => {
          return { type: 'dns', value }
        })
      )
    ]
  })
  const privateKey = await crypto.subtle.exportKey('pkcs8', keys.privateKey)

  return {
    certificate: certificate.toString('pem'),
    privateKey: PemConverter.encode(privateKey, 'PRIVATE KEY')
  }
}
