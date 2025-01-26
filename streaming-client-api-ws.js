'use strict';
const fetchJsonFile = await fetch('./api.json');
const DID_API = await fetchJsonFile.json();

if (DID_API.key == '🤫') alert('Please put your api key inside ./api.json and restart..');

const RTCPeerConnection = (
  window.RTCPeerConnection ||
  window.webkitRTCPeerConnection ||
  window.mozRTCPeerConnection
).bind(window);

let peerConnection;
let pcDataChannel;
let streamId;
let sessionId;
let sessionClientAnswer;

let statsIntervalId;
let lastBytesReceived;
let videoIsPlaying = false;
let streamVideoOpacity = 0;

// Set this variable to true to request stream warmup upon connection to mitigate potential jittering issues
const stream_warmup = true;
let isStreamReady = !stream_warmup;

const idleVideoElement = document.getElementById('idle-video-element');
const streamVideoElement = document.getElementById('stream-video-element');
idleVideoElement.setAttribute('playsinline', '');
streamVideoElement.setAttribute('playsinline', '');
const peerStatusLabel = document.getElementById('peer-status-label');
const iceStatusLabel = document.getElementById('ice-status-label');
const iceGatheringStatusLabel = document.getElementById('ice-gathering-status-label');
const signalingStatusLabel = document.getElementById('signaling-status-label');
const streamingStatusLabel = document.getElementById('streaming-status-label');
const streamEventLabel = document.getElementById('stream-event-label');

const presenterInputByService = {
  talks: {
    source_url: 'https://d-id-public-bucket.s3.amazonaws.com/or-roman.jpg',
  },
  clips: {
    presenter_id: "v2_private_google_oauth2_104801735175324515033@SyT5o7jAMf",
    driver_id: "QNy9KesfFk",
  },
};

const PRESENTER_TYPE = 'clip';

const connectButton = document.getElementById('connect-button');
let ws;

connectButton.onclick = async () => {
  if (peerConnection && peerConnection.connectionState === 'connected') {
    return;
  }

  stopAllStreams();
  closePC();

  try {
    // Step 1: Connect to WebSocket
    ws = await connectToWebSocket(DID_API.websocketUrl, DID_API.key);
    console.log('WebSocket ws', ws);

    // Step 2: Send "init-stream" message to WebSocket
    const startStreamMessage = {
      type: 'init-stream',
      payload: {
        // source_url: 'https://create-images-results.d-id.com/DefaultPresenters/Brandon_m/thumbnail.jpeg',
        // presenter_id: "v2_public_custom_d_id_santa@a0qu7xwvkd",
        // presenter_id: "v2_private_custom_d_id_santa@a0qu7xwvkd",
        // presenter_id: "v2_custom_terraquantum_woman@eihz9frmlt",
        // driver_id: "qbjnnuexec",
        // driver_id: "qbjnnuexec",
        ...presenterInputByService[DID_API.service],
        // driver_id: "wvbkvm_94f",
        // presenter_id: 'rian-lZC6MmWfC1',
        // driver_id: 'mXra4jY38i',
        presenter_type: PRESENTER_TYPE,
      },
    };
    sendMessage(ws, startStreamMessage);

    // Step 3: Handle WebSocket response for "init-stream"
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = data;
      streamId = newStreamId;
      sessionId = newSessionId;

      console.log('init-stream response', streamId, sessionId);

      try {
        sessionClientAnswer = await createPeerConnection(offer, iceServers);

        console.log('got sessionClientAnswer', sessionClientAnswer);

        // Step 4: Send SDP answer to WebSocket
        const sdpMessage = {
          type: 'sdp',
          payload: {
            answer: sessionClientAnswer,
            session_id: sessionId,
            // stream_id: streamId,
            presenter_type: PRESENTER_TYPE,
          },
        };
        sendMessage(ws, sdpMessage);
        ws.onmessage = async (event) => {
          console.log('SDP message received:', event.data);
        };
      } catch (e) {
        console.log('Error during streaming setup', e);
        stopAllStreams();
        closePC();
        return;
      }
    };
  } catch (error) {
    console.error('Failed to connect and set up stream:', error.type);
  }
};

const streamAudioButton = document.getElementById('stream-audio-button');
streamAudioButton.onclick = async () => {
  if (
    (peerConnection?.signalingState === 'stable' || peerConnection?.iceConnectionState === 'connected') &&
    isStreamReady
  ) {
    try {
      const pcmData = await loadPCMData();
      sendChunkedPCMData(ws, pcmData);
    } catch (error) {
      console.error('Error streaming audio:', error);
    }
  }
};

const streamWordButton = document.getElementById('stream-word-button');
streamWordButton.onclick = async () => {
  const text =
    'In a quiet little town, there stood an old brick school with ivy creeping up its walls. Inside, the halls buzzed with the sounds of chattering students and echoing footsteps. ';
  const chunks = text.split(' ');
  // const chunks = text.split(' ').reduce((acc, word, index) => {
  //     const chunkIndex = Math.floor(index / 6); // Group every 6 words
  //     if (!acc[chunkIndex]) {
  //       acc[chunkIndex] = []; // Create a new array for the current chunk
  //     }
  //     acc[chunkIndex].push(word);
  //     return acc;
  //   }, []).map(chunk => chunk.join(' '));
  chunks.push('');
  for (const [index, chunk] of chunks.entries()) {
    const streamMessage = {
      type: 'stream-text',
      payload: {
        input: chunk,
        provider: {
          type: 'elevenlabs',
          voice_id: '21m00Tcm4TlvDq8ikWAM',
        },
        //   provider: {
        //     type: 'elevenlabs',
        //     voice_id: '21m00Tcm4TlvDq8ikWAM',
        //   },
        config: {
          stitch: true,
        },
        // provider: {
        //   type: 'microsoft',
        //   voice_id: 'en-AU-WilliamNeural',
        // },
        apiKeysExternal: {
          elevenlabs: { key: '' },
          //     microsoft: {
          //     key: 'key here',
          //     region: 'westeurope',
          //     endpointId: 'c886c006-f39d-410d-aa9c-b0ff25c5cbb8',
          //     },
        },
        //   clipData: {
        background: {
          color: '#FFFFFF',
        },
        //   },
        session_id: sessionId,
        stream_id: streamId,
        presenter_type: PRESENTER_TYPE,
      },
    };
    sendMessage(ws, streamMessage);
    ws.onmessage = async (event) => {
      console.log('Stream message received:', event.data);
    };
  }
};

const destroyButton = document.getElementById('destroy-button');
destroyButton.onclick = async () => {
  const streamMessage = {
    type: 'delete-stream',
    payload: {
      session_id: sessionId,
      stream_id: streamId,
    },
  };
  sendMessage(ws, streamMessage);
  ws.onmessage = async (event) => {
    console.log('Stream deleted:', event.data);
  };

  stopAllStreams();
  closePC();
};

function onIceGatheringStateChange() {
  iceGatheringStatusLabel.innerText = peerConnection.iceGatheringState;
  iceGatheringStatusLabel.className = 'iceGatheringState-' + peerConnection.iceGatheringState;
}
function onIceCandidate(event) {
  console.log('onIceCandidate', event);
  if (event.candidate) {
    const { candidate, sdpMid, sdpMLineIndex } = event.candidate;
    sendMessage(ws, {
      type: 'ice',
      payload: {
        // stream_id: streamId,
        session_id: sessionId,
        candidate,
        sdpMid,
        sdpMLineIndex,
      },
    });
    ws.onmessage = async (event) => {
      console.log('Ice message received:', event.data);
    };
  } else {
    sendMessage(ws, {
      type: 'ice',
      payload: {
        stream_id: streamId,
        session_id: sessionId,
        presenter_type: PRESENTER_TYPE,
      },
    });
    ws.onmessage = async (event) => {
      console.log('Ice message received on else:', event.data);
    };
  }
}
function onIceConnectionStateChange() {
  iceStatusLabel.innerText = peerConnection.iceConnectionState;
  iceStatusLabel.className = 'iceConnectionState-' + peerConnection.iceConnectionState;
  if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'closed') {
    stopAllStreams();
    closePC();
  }
}
function onConnectionStateChange() {
  // not supported in firefox
  peerStatusLabel.innerText = peerConnection.connectionState;
  peerStatusLabel.className = 'peerConnectionState-' + peerConnection.connectionState;
  console.log('peerConnection', peerConnection.connectionState);

  if (peerConnection.connectionState === 'connected') {
    playIdleVideo();
    /**
     * A fallback mechanism: if the 'stream/ready' event isn't received within 5 seconds after asking for stream warmup,
     * it updates the UI to indicate that the system is ready to start streaming data.
     */
    setTimeout(() => {
      if (!isStreamReady) {
        console.log('forcing stream/ready');
        isStreamReady = true;
        streamEventLabel.innerText = 'ready';
        streamEventLabel.className = 'streamEvent-ready';
      }
    }, 5000);
  }
}
function onSignalingStateChange() {
  signalingStatusLabel.innerText = peerConnection.signalingState;
  signalingStatusLabel.className = 'signalingState-' + peerConnection.signalingState;
}

function onVideoStatusChange(videoIsPlaying, stream) {
  let status;

  if (videoIsPlaying) {
    status = 'streaming';
    streamVideoOpacity = isStreamReady ? 1 : 0;
    setStreamVideoElement(stream);
  } else {
    status = 'empty';
    streamVideoOpacity = 0;
  }

  streamVideoElement.style.opacity = streamVideoOpacity;
  idleVideoElement.style.opacity = 1 - streamVideoOpacity;

  streamingStatusLabel.innerText = status;
  streamingStatusLabel.className = 'streamingState-' + status;
}

function onTrack(event) {
  /**
   * The following code is designed to provide information about wether currently there is data
   * that's being streamed - It does so by periodically looking for changes in total stream data size
   *
   * This information in our case is used in order to show idle video while no video is streaming.
   * To create this idle video use the POST https://api.d-id.com/talks (or clips) endpoint with a silent audio file or a text script with only ssml breaks
   * https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html#break-tag
   * for seamless results use `config.fluent: true` and provide the same configuration as the streaming video
   */

  if (!event.track) return;

  statsIntervalId = setInterval(async () => {
    const stats = await peerConnection.getStats(event.track);
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const videoStatusChanged = videoIsPlaying !== report.bytesReceived > lastBytesReceived;

        if (videoStatusChanged) {
          videoIsPlaying = report.bytesReceived > lastBytesReceived;
          onVideoStatusChange(videoIsPlaying, event.streams[0]);
        }
        lastBytesReceived = report.bytesReceived;
      }
    });
  }, 500);
}

function onStreamEvent(message) {
  /**
   * This function handles stream events received on the data channel.
   * The 'stream/ready' event received on the data channel signals the end of the 2sec idle streaming.
   * Upon receiving the 'ready' event, we can display the streamed video if one is available on the stream channel.
   * Until the 'ready' event is received, we hide any streamed video.
   * Additionally, this function processes events for stream start, completion, and errors. Other data events are disregarded.
   */

  if (pcDataChannel.readyState === 'open') {
    let status;
    const [event, _] = message.data.split(':');

    switch (event) {
      case 'stream/started':
        status = 'started';
        break;
      case 'stream/done':
        status = 'done';
        break;
      case 'stream/ready':
        status = 'ready';
        break;
      case 'stream/error':
        status = 'error';
        break;
      default:
        status = 'dont-care';
        break;
    }

    // Set stream ready after a short delay, adjusting for potential timing differences between data and stream channels
    if (status === 'ready') {
      setTimeout(() => {
        console.log('stream/ready');
        isStreamReady = true;
        streamEventLabel.innerText = 'ready';
        streamEventLabel.className = 'streamEvent-ready';
      }, 1000);
    } else {
      console.log(event);
      streamEventLabel.innerText = status === 'dont-care' ? event : status;
      streamEventLabel.className = 'streamEvent-' + status;
    }
  }
}

async function createPeerConnection(offer, iceServers) {
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({ iceServers });
    pcDataChannel = peerConnection.createDataChannel('JanusDataChannel');
    peerConnection.addEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
    peerConnection.addEventListener('icecandidate', onIceCandidate, true);
    peerConnection.addEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
    peerConnection.addEventListener('connectionstatechange', onConnectionStateChange, true);
    peerConnection.addEventListener('signalingstatechange', onSignalingStateChange, true);
    peerConnection.addEventListener('track', onTrack, true);
    pcDataChannel.addEventListener('message', onStreamEvent, true);
  }

  await peerConnection.setRemoteDescription(offer);
  console.log('set remote sdp OK');

  const sessionClientAnswer = await peerConnection.createAnswer();
  console.log('create local sdp OK');

  await peerConnection.setLocalDescription(sessionClientAnswer);
  console.log('set local sdp OK');

  return sessionClientAnswer;
}

function setStreamVideoElement(stream) {
  if (!stream) return;

  streamVideoElement.srcObject = stream;
  streamVideoElement.loop = false;
  streamVideoElement.mute = !isStreamReady;

  // safari hotfix
  if (streamVideoElement.paused) {
    streamVideoElement
      .play()
      .then((_) => {})
      .catch((e) => {});
  }
}

function playIdleVideo() {
  idleVideoElement.src = DID_API.service == 'clips' ? 'rian_idle.mp4' : 'or_idle.mp4';
}

function stopAllStreams() {
  if (streamVideoElement.srcObject) {
    console.log('stopping video streams');
    streamVideoElement.srcObject.getTracks().forEach((track) => track.stop());
    streamVideoElement.srcObject = null;
    streamVideoOpacity = 0;
  }
}

function closePC(pc = peerConnection) {
  if (!pc) return;
  console.log('stopping peer connection');
  pc.close();
  pc.removeEventListener('icegatheringstatechange', onIceGatheringStateChange, true);
  pc.removeEventListener('icecandidate', onIceCandidate, true);
  pc.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange, true);
  pc.removeEventListener('connectionstatechange', onConnectionStateChange, true);
  pc.removeEventListener('signalingstatechange', onSignalingStateChange, true);
  pc.removeEventListener('track', onTrack, true);
  pc.removeEventListener('onmessage', onStreamEvent, true);

  clearInterval(statsIntervalId);
  isStreamReady = !stream_warmup;
  streamVideoOpacity = 0;
  iceGatheringStatusLabel.innerText = '';
  signalingStatusLabel.innerText = '';
  iceStatusLabel.innerText = '';
  peerStatusLabel.innerText = '';
  streamEventLabel.innerText = '';
  console.log('stopped peer connection');
  if (pc === peerConnection) {
    peerConnection = null;
  }
}

const maxRetryCount = 3;
const maxDelaySec = 4;

async function connectToWebSocket(url, token) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${url}?authorization=Basic ${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('WebSocket connection opened.');
      resolve(ws);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      reject(err);
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed.');
    };
  });
}

function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    console.log('Message sent:', message);
  } else {
    console.error('WebSocket is not open. Cannot send message.');
  }
}

/**
 * Load audio-messages-pcm.json and stream audio chunks
 */
async function loadPCMData() {
  const response = await fetch('./audio-messages-pcm.json');
  if (!response.ok) throw new Error('Failed to load PCM data');
  const pcmData = await response.json();
  return pcmData;
}

function stringToArrayBuffer(string) {
  const len = string.length;
  const bytes = new Uint16Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = string.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer2(base64) {
  // Decode the base64 string into binary string
  const binaryString = atob(base64);

  // Create a new ArrayBuffer with the same length as the binary string
  const buffer = new ArrayBuffer(binaryString.length);

  // Create a view for the ArrayBuffer
  const view = new Uint8Array(buffer);

  // Populate the ArrayBuffer with the binary data
  for (let i = 0; i < binaryString.length; i++) {
      view[i] = binaryString.charCodeAt(i);
  }

  return buffer;
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint16Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function createWavHeader(audioBufferLength, sampleRate = 44100, numChannels = 1) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false);
  // file length minus RIFF identifier length and file description length
  view.setUint32(4, 36 + audioBufferLength, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false);
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false);
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * numChannels * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, numChannels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false);
  // data chunk length
  view.setUint32(40, audioBufferLength, true);

  return header;
}

function concatenateArrayBuffers(buffer1, buffer2) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}

function decodeBase64ToWav(base64Audio) {
  const audioArrayBuffer = base64ToArrayBuffer(base64Audio);
  const wavHeader = createWavHeader(audioArrayBuffer.byteLength);
  const wavArrayBuffer = concatenateArrayBuffers(wavHeader, audioArrayBuffer);
  return wavArrayBuffer;
}

function sendSubChunks(ws, delta, chunkSize = 3 * 1024) {
  const arrayBuffer = decodeBase64ToWav(delta);
  const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
  console.log(`Sub chunk size: ${arrayBuffer.byteLength} bytes, Total chunks: ${totalChunks}`);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
    const chunk = new Uint16Array(arrayBuffer.slice(start, end));
    const input = Array.from(chunk);
    console.log(`Streaming chunk ${i + 1}/${totalChunks}, size: ${chunk.length} bytes`);

    const streamMessage = {
      type: 'stream-audio',
      payload: {
        input,
        config: {
          stitch: true,
        },
        session_id: sessionId,
        stream_id: streamId,
        presenter_type: PRESENTER_TYPE,
      },
    };
    if (input.length === 0) {
      console.log('ERRORRRRRRR: input is empty in the middle of the stream');
    } else {
      sendMessage(ws, streamMessage);
    }
  }
}

function sendChunkedPCMData(ws, pcmData, chunkSize = 3 * 1024) {
  // const halfwayPoint = Math.floor(pcmData.length / 2);
  pcmData.forEach((event, count) => {
    if (event.type === 'response.audio.delta') {
      console.log(`Send sub chunk, N.${count}`);
      sendSubChunks(ws, event.delta, chunkSize);
    } else if (event.type === 'response.audio.done') {
      console.log('Send last chunk');
      sendMessage(ws, {
        type: 'stream-audio',
        payload: {
          input: Array.from(new Uint16Array(0)),
          config: {
            stitch: true,
          },
          session_id: sessionId,
          stream_id: streamId,
          presenter_type: PRESENTER_TYPE,
        },
      });
    }
  });
}
