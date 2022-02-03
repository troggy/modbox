import aws4 from 'aws4'
import { hasNonNullableKeys } from '@modbox/ts-utils'

import { TYPE_CONDITIONS, MULTIPART_CHUNK_SIZE } from './config'
import { buildBucketHostname } from './helpers'
import { Config } from './types'

export const getPartPresignedRequestInfo = (
  config: Config<string, true>,
  {
    partNumber,
    uploadId,
    key,
    bucket,
  }: {
    partNumber: number
    uploadId: string
    key: string
    bucket: string
  },
): {
  url: string
  headers: {
    key: string
    value: string
  }[]
} => {
  const presignedRequest = aws4.sign(
    {
      method: 'PUT',
      path: `/${key}?partNumber=${partNumber}&uploadId=${uploadId}`,
      service: 's3',
      region: config.s3Config.region,
      host: buildBucketHostname(config, bucket),
    },
    {
      accessKeyId: config.s3Config.credentials.accessKeyId,
      secretAccessKey: config.s3Config.credentials.secretAccessKey,
    },
  )

  if (!hasNonNullableKeys(presignedRequest, ['headers'])) {
    throw new Error('invalid_presigned_request_headers')
  }

  return {
    url: `https://${presignedRequest.host}${presignedRequest.path}`,
    headers: Object.keys(presignedRequest.headers).map((key) => ({
      key,
      value: presignedRequest.headers[key] as string,
    })),
  }
}

export const initiatePresignedMultipartUpload = async (
  config: Config<string, true>,
  {
    mimetype,
    bucket,
    key,
    size,
  }: {
    mimetype: string
    bucket: string
    key: string
    size: number
  },
): Promise<{
  uploadId: string
  size: number
  chunkSize: number
  partsCount: number
}> => {
  const typeConditions = TYPE_CONDITIONS.find(({ types }) =>
    types.some((t) => mimetype.includes(t)),
  )
  const matchingType = typeConditions?.types.find((t) => mimetype.includes(t))
  if (!typeConditions || !matchingType) {
    throw new Error('core.upload.error.unauthorized_file_type')
  }

  const { UploadId: uploadId } = await config.s3Client
    .createMultipartUpload({
      Bucket: bucket,
      Key: key,
    })
    .promise()

  if (!uploadId) {
    throw new Error('core.lib.error.generic_message')
  }

  const partsCount = Math.ceil(size / MULTIPART_CHUNK_SIZE)

  return {
    chunkSize: MULTIPART_CHUNK_SIZE,
    size,
    partsCount,
    uploadId,
  }
}

export const completeMultipartUpload = async (
  config: Config<string, true>,
  {
    bucket,
    key,
    uploadId,
    parts,
  }: {
    bucket: string
    key: string
    uploadId: string
    parts: {
      etag: string
      partNumber: number
    }[]
  },
): Promise<void> => {
  await config.s3Client
    .completeMultipartUpload({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
      },
    })
    .promise()
}