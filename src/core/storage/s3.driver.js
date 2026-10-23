import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Any S3-compatible object store: Cloudflare R2, AWS S3, MinIO. The bucket must be private. */
export function createS3Driver({ endpoint, region, bucket, accessKeyId, secretAccessKey }) {
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint), // R2 / MinIO
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    name: "s3",
    async put(key, buffer, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return result.Body;
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
