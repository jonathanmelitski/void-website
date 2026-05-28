import {
  MediaConvertClient,
  CreateJobCommand,
  GetJobCommand,
  type JobStatus,
} from "@aws-sdk/client-mediaconvert"

function client() {
  return new MediaConvertClient({
    endpoint: process.env.MEDIACONVERT_ENDPOINT!,
    region: process.env.AWS_REGION ?? "us-east-2",
  })
}

export async function createMediaConvertJob(opts: {
  s3RawKey: string
  outputPrefix: string
  title: string
}): Promise<string> {
  const bucket = process.env.FILM_S3_BUCKET_NAME!
  const inputUri = `s3://${bucket}/${opts.s3RawKey}`
  // Explicit base name so MediaConvert creates `index.m3u8` as the master playlist.
  // A trailing-slash destination causes MediaConvert to derive the name from the input filename.
  const outputUri = `s3://${bucket}/${opts.outputPrefix.replace(/\/$/, "")}/index`

  const result = await client().send(
    new CreateJobCommand({
      Role: process.env.MEDIACONVERT_ROLE_ARN!,
      Queue: process.env.MEDIACONVERT_QUEUE_ARN,
      Settings: {
        Inputs: [
          {
            FileInput: inputUri,
            AudioSelectors: { "Audio Selector 1": { DefaultSelection: "DEFAULT" } },
            VideoSelector: {},
            TimecodeSource: "ZEROBASED",
          },
        ],
        OutputGroups: [
          {
            Name: "HLS",
            OutputGroupSettings: {
              Type: "HLS_GROUP_SETTINGS",
              HlsGroupSettings: {
                Destination: outputUri,
                SegmentLength: 6,
                MinSegmentLength: 0,
              },
            },
            Outputs: [
              {
                NameModifier: "_1080p",
                ContainerSettings: { Container: "M3U8", M3u8Settings: {} },
                VideoDescription: {
                  ColorMetadata: "INSERT",
                  Width: 1920, Height: 1080,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      QvbrSettings: { QvbrQualityLevel: 8 },
                      MaxBitrate: 5_000_000,
                      GopSize: 90, GopSizeUnits: "FRAMES",
                      ParControl: "INITIALIZE_FROM_SOURCE",
                    },
                  },
                },
                AudioDescriptions: [{ CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } }],
              },
              {
                NameModifier: "_720p",
                ContainerSettings: { Container: "M3U8", M3u8Settings: {} },
                VideoDescription: {
                  Width: 1280, Height: 720,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      QvbrSettings: { QvbrQualityLevel: 7 },
                      MaxBitrate: 3_500_000,
                      GopSize: 90, GopSizeUnits: "FRAMES",
                      ParControl: "INITIALIZE_FROM_SOURCE",
                    },
                  },
                },
                AudioDescriptions: [{ CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } }],
              },
              {
                NameModifier: "_480p",
                ContainerSettings: { Container: "M3U8", M3u8Settings: {} },
                VideoDescription: {
                  Width: 854, Height: 480,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      QvbrSettings: { QvbrQualityLevel: 6 },
                      MaxBitrate: 1_500_000,
                      GopSize: 90, GopSizeUnits: "FRAMES",
                      ParControl: "INITIALIZE_FROM_SOURCE",
                    },
                  },
                },
                AudioDescriptions: [{ CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 96000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } }],
              },
            ],
          },
        ],
      },
    })
  )

  const jobId = result.Job?.Id
  if (!jobId) throw new Error("MediaConvert did not return a job ID")
  return jobId
}

export async function getMediaConvertJobStatus(jobId: string): Promise<{
  status: "COMPLETE" | "ERROR" | "IN_PROGRESS" | "SUBMITTED"
  cloudfrontHlsUrl?: string
  durationSeconds?: number
  errorMessage?: string
}> {
  const result = await client().send(new GetJobCommand({ Id: jobId }))
  const job = result.Job
  if (!job) throw new Error("Job not found")

  const rawStatus = job.Status as JobStatus
  if (rawStatus === "COMPLETE") {
    const outputDetails = job.OutputGroupDetails?.[0]?.OutputDetails?.[0]
    const durationMs = outputDetails?.DurationInMs
    const destination = job.Settings?.OutputGroups?.[0]?.OutputGroupSettings?.HlsGroupSettings?.Destination ?? ""
    const bucket = process.env.FILM_S3_BUCKET_NAME!
    const cfBase = process.env.CLOUDFRONT_FILM_BASE_URL!.replace(/\/$/, "")
    const key = destination.replace(`s3://${bucket}/`, "")
    // Destination is "s3://bucket/hls/{id}/index" — append .m3u8 to get the master playlist URL
    const cloudfrontHlsUrl = `${cfBase}/${key}.m3u8`

    return {
      status: "COMPLETE",
      cloudfrontHlsUrl,
      durationSeconds: durationMs ? Math.round(durationMs / 1000) : undefined,
    }
  }

  if (rawStatus === "ERROR" || rawStatus === "CANCELED") {
    return {
      status: "ERROR",
      errorMessage: job.ErrorMessage ?? "MediaConvert job failed",
    }
  }

  if (rawStatus === "SUBMITTED") return { status: "SUBMITTED" }
  return { status: "IN_PROGRESS" }
}
