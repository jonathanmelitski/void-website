import {
  MediaLiveClient,
  CreateInputCommand,
  DeleteInputCommand,
  CreateInputSecurityGroupCommand,
  DeleteInputSecurityGroupCommand,
  ListInputSecurityGroupsCommand,
  CreateChannelCommand,
  DeleteChannelCommand,
  ListChannelsCommand,
  ListInputsCommand,
  StartChannelCommand,
  StopChannelCommand,
  DescribeChannelCommand,
  BatchUpdateScheduleCommand,
} from "@aws-sdk/client-medialive"

const ROLE_ARN = "arn:aws:iam::217828988640:role/MediaLiveAccessRole"
const SCOREBOARD_BASE = "https://voidultimate.com/live/scoreboard"
const YOUTUBE_STREAM_KEY = process.env.YOUTUBE_STREAM_KEY ?? ""

const medialive = new MediaLiveClient({
  region: process.env.VOID_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

export type ChannelState =
  | "CREATING" | "CREATE_FAILED" | "IDLE" | "STARTING"
  | "RUNNING" | "RECOVERING" | "STOPPING" | "DELETING" | "DELETED"

export type CreateRtmpInputResult = {
  inputId: string
  endpointIp: string
  rtmpUrl: string
}

// ---- Input Security Group ----

export async function createInputSecurityGroup(): Promise<string> {
  const res = await medialive.send(new CreateInputSecurityGroupCommand({
    WhitelistRules: [{ Cidr: "0.0.0.0/0" }],
  }))
  const groupId = res.SecurityGroup?.Id
  if (!groupId) throw new Error("MediaLive: CreateInputSecurityGroup returned no Id")
  return groupId
}

export async function deleteInputSecurityGroup(groupId: string): Promise<void> {
  await medialive.send(new DeleteInputSecurityGroupCommand({ InputSecurityGroupId: groupId }))
}

// ---- RTMP Push Input ----

export async function createRtmpInput(
  gameId: string,
  securityGroupId: string,
): Promise<CreateRtmpInputResult> {
  const res = await medialive.send(new CreateInputCommand({
    Name: `void-rtmp-${gameId}`,
    Type: "RTMP_PUSH",
    Destinations: [{ StreamName: gameId }],
    InputSecurityGroups: [securityGroupId],
  }))

  const input = res.Input
  if (!input?.Id) throw new Error("MediaLive: CreateInput returned no Id")

  const dest = input.Destinations?.[0]
  if (!dest?.Ip) throw new Error("MediaLive: RTMP input has no destination IP")

  return {
    inputId: input.Id,
    endpointIp: dest.Ip,
    rtmpUrl: `rtmp://stream.voidultimate.com/${gameId}`,
  }
}

export async function deleteInput(inputId: string): Promise<void> {
  await medialive.send(new DeleteInputCommand({ InputId: inputId }))
}

// ---- Channel ----

// Creates a channel from the voidchannel.json template, wiring in the RTMP input.
export async function createChannel(inputId: string): Promise<string> {
  const res = await medialive.send(new CreateChannelCommand({
    Name: `void-broadcast-${Date.now()}`,
    ChannelClass: "SINGLE_PIPELINE",
    RoleArn: ROLE_ARN,
    InputSpecification: {
      Codec: "AVC",
      MaximumBitrate: "MAX_20_MBPS",
      Resolution: "HD",
    },
    InputAttachments: [{
      InputAttachmentName: "live-input",
      InputId: inputId,
      InputSettings: {
        AudioSelectors: [],
        CaptionSelectors: [],
        DeblockFilter: "DISABLED",
        DenoiseFilter: "DISABLED",
        FilterStrength: 1,
        InputFilter: "AUTO",
        Smpte2038DataPreference: "IGNORE",
        SourceEndBehavior: "CONTINUE",
      },
    }],
    Destinations: [{
      Id: "65e5d",
      Settings: [{
        Url: "rtmp://a.rtmp.youtube.com/live2/",
        StreamName: YOUTUBE_STREAM_KEY,
      }],
    }],
    EncoderSettings: {
      AudioDescriptions: [{
        AudioSelectorName: "default",
        Name: "audio_bedijc",
      }],
      CaptionDescriptions: [],
      MotionGraphicsConfiguration: {
        MotionGraphicsInsertion: "ENABLED",
        MotionGraphicsSettings: {
          HtmlMotionGraphicsSettings: {},
        },
      },
      OutputGroups: [{
        OutputGroupSettings: {
          RtmpGroupSettings: {
            AdMarkers: [],
            AuthenticationScheme: "COMMON",
            CacheFullBehavior: "WAIT_FOR_SERVER",
            CacheLength: 30,
            CaptionData: "ALL",
            IncludeFillerNalUnits: "AUTO",
            InputLossAction: "EMIT_OUTPUT",
            RestartDelay: 15,
          },
        },
        Outputs: [{
          AudioDescriptionNames: ["audio_bedijc"],
          CaptionDescriptionNames: [],
          OutputName: "65e5d",
          OutputSettings: {
            RtmpOutputSettings: {
              CertificateMode: "VERIFY_AUTHENTICITY",
              ConnectionRetryInterval: 2,
              Destination: { DestinationRefId: "65e5d" },
              NumRetries: 100,
            },
          },
          VideoDescriptionName: "video_570gok",
        }],
      }],
      TimecodeConfig: { Source: "EMBEDDED" },
      VideoDescriptions: [{
        CodecSettings: {
          H264Settings: {
            AdaptiveQuantization: "AUTO",
            AfdSignaling: "NONE",
            ColorMetadata: "INSERT",
            EntropyEncoding: "CABAC",
            FlickerAq: "ENABLED",
            ForceFieldPictures: "DISABLED",
            FramerateControl: "SPECIFIED",
            FramerateDenominator: 1,
            FramerateNumerator: 60,
            GopBReference: "DISABLED",
            GopClosedCadence: 1,
            GopSize: 90,
            GopSizeUnits: "FRAMES",
            Level: "H264_LEVEL_AUTO",
            LookAheadRateControl: "MEDIUM",
            NumRefFrames: 1,
            ParControl: "INITIALIZE_FROM_SOURCE",
            Profile: "MAIN",
            RateControlMode: "CBR",
            ScanType: "PROGRESSIVE",
            SceneChangeDetect: "ENABLED",
            SpatialAq: "ENABLED",
            SubgopLength: "FIXED",
            Syntax: "DEFAULT",
            TemporalAq: "ENABLED",
            TimecodeInsertion: "DISABLED",
          },
        },
        Height: 1080,
        Name: "video_570gok",
        RespondToAfd: "NONE",
        ScalingBehavior: "STRETCH_TO_OUTPUT",
        Sharpness: 50,
        Width: 1920,
      }],
    },
  }))

  const channelId = res.Channel?.Id
  if (!channelId) throw new Error("MediaLive: CreateChannel returned no Id")
  return channelId
}

export async function deleteChannel(channelId: string): Promise<void> {
  await medialive.send(new DeleteChannelCommand({ ChannelId: channelId }))
}

export async function startChannel(channelId: string): Promise<void> {
  await medialive.send(new StartChannelCommand({ ChannelId: channelId }))
}

export async function stopChannel(channelId: string): Promise<void> {
  await medialive.send(new StopChannelCommand({ ChannelId: channelId }))
}

export async function getChannelStatus(channelId: string): Promise<ChannelState> {
  try {
    const res = await medialive.send(new DescribeChannelCommand({ ChannelId: channelId }))
    return (res.State ?? "IDLE") as ChannelState
  } catch (e: unknown) {
    // Channel not found — it was deleted
    if (e instanceof Error && e.name === "NotFoundException") return "DELETED"
    throw e
  }
}

export async function waitForChannelState(
  channelId: string,
  targetState: ChannelState,
  timeoutMs = 300_000,
  pollIntervalMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await getChannelStatus(channelId)
    if (state === targetState) return
    if (state === "CREATE_FAILED") throw new Error("MediaLive channel entered CREATE_FAILED")
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  throw new Error(`Timeout waiting for channel to reach ${targetState}`)
}

// ---- HTML Motion Graphics Overlay ----

export async function scheduleGraphicsOverlay(channelId: string, gameId: string): Promise<void> {
  await medialive.send(new BatchUpdateScheduleCommand({
    ChannelId: channelId,
    Creates: {
      ScheduleActions: [{
        ActionName: `overlay-activate-${Date.now()}`,
        ScheduleActionSettings: {
          MotionGraphicsImageActivateSettings: {
            Url: `${SCOREBOARD_BASE}/${gameId}`,
          },
        },
        ScheduleActionStartSettings: {
          ImmediateModeScheduleActionStartSettings: {},
        },
      }],
    },
  }))
}

export async function deactivateGraphicsOverlay(channelId: string): Promise<void> {
  await medialive.send(new BatchUpdateScheduleCommand({
    ChannelId: channelId,
    Creates: {
      ScheduleActions: [{
        ActionName: `overlay-deactivate-${Date.now()}`,
        ScheduleActionSettings: {
          MotionGraphicsImageDeactivateSettings: {},
        },
        ScheduleActionStartSettings: {
          ImmediateModeScheduleActionStartSettings: {},
        },
      }],
    },
  }))
}

// ---- List helpers (used by streaming destroy-all in API route) ----

export type VoidChannelInfo = { id: string; name: string; state: string }
export type VoidInputInfo = { id: string; name: string }
export type VoidInputSGInfo = { id: string; inputCount: number }

export async function listVoidChannels(): Promise<VoidChannelInfo[]> {
  const res = await medialive.send(new ListChannelsCommand({}))
  return (res.Channels ?? [])
    .filter(c => c.Name?.startsWith("void-broadcast-") && c.Id)
    .map(c => ({ id: c.Id!, name: c.Name!, state: c.State ?? "UNKNOWN" }))
}

export async function listVoidInputs(): Promise<VoidInputInfo[]> {
  const res = await medialive.send(new ListInputsCommand({}))
  return (res.Inputs ?? [])
    .filter(i => i.Name?.startsWith("void-rtmp-") && i.Id)
    .map(i => ({ id: i.Id!, name: i.Name! }))
}

export async function listVoidInputSecurityGroups(): Promise<VoidInputSGInfo[]> {
  const res = await medialive.send(new ListInputSecurityGroupsCommand({}))
  return (res.InputSecurityGroups ?? [])
    .filter(sg => sg.Id)
    .map(sg => ({ id: sg.Id!, inputCount: (sg.Inputs ?? []).length }))
}

// ---- Destroy All ----
// Nukes every void-broadcast-* channel, void-rtmp-* input, and all input security groups.
// Used for emergency cleanup regardless of DynamoDB state.

export type DestroyAllResult = {
  channelsDeleted: string[]
  inputsDeleted: string[]
  securityGroupsDeleted: string[]
  errors: string[]
}

export async function destroyAll(): Promise<DestroyAllResult> {
  const result: DestroyAllResult = {
    channelsDeleted: [],
    inputsDeleted: [],
    securityGroupsDeleted: [],
    errors: [],
  }

  // 1. Stop → wait IDLE → delete → wait DELETED for all void-broadcast-* channels
  try {
    const channelsRes = await medialive.send(new ListChannelsCommand({}))
    const voidChannels = (channelsRes.Channels ?? []).filter(
      c => c.Name?.startsWith("void-broadcast-")
    )
    for (const ch of voidChannels) {
      if (!ch.Id) continue
      if (ch.State === "RUNNING" || ch.State === "STARTING") {
        try { await medialive.send(new StopChannelCommand({ ChannelId: ch.Id })) } catch (e) {
          result.errors.push(`Stop channel ${ch.Id}: ${e instanceof Error ? e.message : e}`)
        }
      }
      // Wait for IDLE before deleting
      try { await waitForChannelState(ch.Id, "IDLE", 120_000) } catch (e) {
        result.errors.push(`Wait IDLE ${ch.Id}: ${e instanceof Error ? e.message : e}`)
      }
      try {
        await medialive.send(new DeleteChannelCommand({ ChannelId: ch.Id }))
        result.channelsDeleted.push(ch.Id)
      } catch (e) {
        result.errors.push(`Delete channel ${ch.Id}: ${e instanceof Error ? e.message : e}`)
        continue
      }
      // Wait for DELETED before inputs can be released
      try { await waitForChannelState(ch.Id, "DELETED", 120_000) } catch (e) {
        result.errors.push(`Wait DELETED ${ch.Id}: ${e instanceof Error ? e.message : e}`)
      }
    }
  } catch (e) {
    result.errors.push(`List channels: ${e instanceof Error ? e.message : e}`)
  }

  // 2. Delete all void-rtmp-* inputs (only after all channels are deleted)
  try {
    const inputsRes = await medialive.send(new ListInputsCommand({}))
    const voidInputs = (inputsRes.Inputs ?? []).filter(
      i => i.Name?.startsWith("void-rtmp-")
    )
    for (const inp of voidInputs) {
      if (!inp.Id) continue
      try {
        await medialive.send(new DeleteInputCommand({ InputId: inp.Id }))
        result.inputsDeleted.push(inp.Id)
      } catch (e) {
        result.errors.push(`Delete input ${inp.Id}: ${e instanceof Error ? e.message : e}`)
      }
    }
  } catch (e) {
    result.errors.push(`List inputs: ${e instanceof Error ? e.message : e}`)
  }

  // 3. Delete all input security groups not in use
  try {
    const sgRes = await medialive.send(new ListInputSecurityGroupsCommand({}))
    for (const sg of sgRes.InputSecurityGroups ?? []) {
      if (!sg.Id) continue
      // Skip if still attached to an input
      if ((sg.Inputs ?? []).length > 0) continue
      try {
        await medialive.send(new DeleteInputSecurityGroupCommand({ InputSecurityGroupId: sg.Id }))
        result.securityGroupsDeleted.push(sg.Id)
      } catch (e) {
        result.errors.push(`Delete SG ${sg.Id}: ${e instanceof Error ? e.message : e}`)
      }
    }
  } catch (e) {
    result.errors.push(`List security groups: ${e instanceof Error ? e.message : e}`)
  }

  return result
}
