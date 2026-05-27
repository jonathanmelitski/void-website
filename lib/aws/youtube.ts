import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from "@aws-sdk/client-ssm"

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-2" })

const SSM_REFRESH_TOKEN = "/void/youtube/refresh_token"
const SSM_CHANNEL_TITLE = "/void/youtube/channel_title"

export async function getYouTubeRefreshToken(): Promise<string> {
  const param = await ssm.send(new GetParameterCommand({ Name: SSM_REFRESH_TOKEN, WithDecryption: true }))
  const token = param.Parameter?.Value
  if (!token) throw new Error("YouTube channel not connected")
  return token
}

export async function getYouTubeConnectionStatus(): Promise<{ connected: boolean; channelTitle?: string }> {
  try {
    const [tokenParam, titleParam] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: SSM_REFRESH_TOKEN, WithDecryption: false })),
      ssm.send(new GetParameterCommand({ Name: SSM_CHANNEL_TITLE })),
    ])
    if (!tokenParam.Parameter) return { connected: false }
    return { connected: true, channelTitle: titleParam.Parameter?.Value }
  } catch {
    return { connected: false }
  }
}

export async function storeYouTubeCredentials(refreshToken: string, channelTitle: string): Promise<void> {
  await Promise.all([
    ssm.send(new PutParameterCommand({ Name: SSM_REFRESH_TOKEN, Value: refreshToken, Type: "SecureString", Overwrite: true })),
    ssm.send(new PutParameterCommand({ Name: SSM_CHANNEL_TITLE, Value: channelTitle, Type: "String", Overwrite: true })),
  ])
}

export async function clearYouTubeCredentials(): Promise<void> {
  await Promise.all([
    ssm.send(new DeleteParameterCommand({ Name: SSM_REFRESH_TOKEN })).catch(() => {}),
    ssm.send(new DeleteParameterCommand({ Name: SSM_CHANNEL_TITLE })).catch(() => {}),
  ])
}
