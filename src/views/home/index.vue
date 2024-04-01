<template>
  <div class="home-page">
    <div class="local-video" :class="callStatus">
      <video ref="localVideoRef" class="video-el" autoplay playsinline></video>
    </div>
    <div v-if="callStatus === CallStatus.CONNECT" class="remote-video">
      <video ref="remoteVideoRef" class="video-el" autoplay playsinline></video>
    </div>
    <div v-if="!scReady" class="center-tip">连接中...</div>
    <template v-else>
      <div
        v-if="callStatus === CallStatus.INIT"
        class="call-btn"
        :class="{ disabled: !callReady }"
        @click="launchCallBefore"
      >
        发起通话
      </div>
      <div v-if="callStatus === CallStatus.CALLING" class="center-tip">
        {{ peerType === PeerType.LAUNCH ? '等待对方接听...' : '对方邀请您视频通话' }}
      </div>
      <div v-if="callStatus !== CallStatus.INIT" class="action-area">
        <div
          class="action-btn accept-btn"
          v-if="callStatus === CallStatus.CALLING && peerType === PeerType.RECEIVE"
          @click="acceptCall"
        >
          ✔
        </div>
        <div class="action-btn reject-btn" @click="stopCall">✖</div>
      </div>
    </template>
    <div v-if="msg" class="msg">{{ msg }}</div>
  </div>
</template>

<script setup lang="ts">
import { io } from 'socket.io-client';

enum CallStatus {
  // 初始
  INIT = 'init',
  // 呼叫中
  CALLING = 'calling',
  // 已接通
  CONNECT = 'connect'
}
enum PeerType {
  // 发起端
  LAUNCH = 'launch',
  // 接收端
  RECEIVE = 'receive'
}
const callStatus = ref<CallStatus>(CallStatus.INIT);
const peerType = ref<PeerType>(PeerType.RECEIVE);

const localVideoRef = ref();
const remoteVideoRef = ref();

const msg = ref('');
const showMsg = (text: string) => {
  msg.value = text;
  setTimeout(() => {
    msg.value = '';
  }, 2000);
};

const scReady = ref(false);
let socket: any = null;
// 连接信令服务器
const initSignalingChannel = () => {
  socket = io('ws://localhost:3000');
  socket.on('connect', () => {
    scReady.value = true;
  });
  socket.on('disconnect', () => {
    scReady.value = false;
  });
  socket.on('checkOnlineStatus', (ready: boolean) => {
    if (ready) {
      launchCall();
    } else {
      showMsg('对方未在线');
    }
  });
  socket.on('call', async () => {
    callStatus.value = CallStatus.CALLING;
  });
  socket.on('stopCall', (_peerType: PeerType) => {
    if (_peerType !== peerType.value) {
      showMsg('对方挂断通话');
    }
    restoreCall();
  });
  socket.on('acceptCall', () => {
    callStatus.value = CallStatus.CONNECT;
    // 开启本地视频流
    localVideoRef.value.srcObject = localMediaStream.value;
    initPeerConnection();
  });
  socket.on('sendAnswer', async (answer: any) => {
    if (peerType.value === PeerType.LAUNCH) {
      const remoteDesc = new RTCSessionDescription(answer);
      await peerConnection!.setRemoteDescription(remoteDesc);
      console.log('收到Answer', answer);
    }
  });
  socket.on('sendOffer', async (offer: any) => {
    if (peerType.value === PeerType.RECEIVE) {
      const remoteDesc = new RTCSessionDescription(offer);
      peerConnection!.setRemoteDescription(remoteDesc);
      console.log('收到Offer', offer);
      const answer = await peerConnection!.createAnswer();
      await peerConnection!.setLocalDescription(answer);
      socket.emit('sendAnswer', answer);
    }
  });
  socket.on('sendCandidate', async (candidate: any, _peerType: PeerType) => {
    if (peerType.value !== _peerType) {
      await peerConnection!.addIceCandidate(candidate);
      console.log(`收到${_peerType}端的candidate`);
    }
  });
};

const callReady = computed(() => {
  return localMediaStream.value;
});

const launchCallBefore = () => {
  if (!callReady.value) {
    showMsg('初始化失败，请刷新页面');
    return;
  }
  socket.emit('checkOnlineStatus');
};
const launchCall = () => {
  peerType.value = PeerType.LAUNCH;
  socket.emit('launchCall');
};
const stopCall = () => {
  socket.emit('stopCall', peerType.value);
};
const acceptCall = () => {
  socket.emit('acceptCall');
};
const restoreCall = () => {
  if (peerConnection) {
    peerConnection!.close();
    peerConnection = null;
  }
  localVideoRef.value && (localVideoRef.value.srcObject = null);
  remoteVideoRef.value && (remoteVideoRef.value.srcObject = null);
  callStatus.value = CallStatus.INIT;
  peerType.value = PeerType.RECEIVE;
};

const localMediaStream = ref<MediaStream | null>(null);
const initMediaStream = async () => {
  const constraints = {
    video: true,
    audio: true
  };
  localMediaStream.value = await navigator.mediaDevices.getUserMedia(constraints);
};

let peerConnection: RTCPeerConnection | null = null;
let remoteMediaStream: MediaStream | null = null;
const initPeerConnection = async () => {
  // const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  peerConnection = new RTCPeerConnection();
  // 添加媒体流
  if (localMediaStream.value) {
    localMediaStream.value.getTracks().forEach((track) => {
      peerConnection!.addTrack(track, localMediaStream.value!);
    });
  }
  peerConnection.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      socket.emit('sendCandidate', event.candidate, peerType.value);
    }
  });
  peerConnection.addEventListener('connectionstatechange', (event) => {
    const connectionState = peerConnection!.connectionState;
    if (connectionState === 'disconnected') {
      showMsg('网络连接异常');
      restoreCall();
    }
  });
  peerConnection.addEventListener('track', (event) => {
    const [remoteStream] = event.streams;
    remoteVideoRef.value.srcObject = remoteStream;
    remoteMediaStream = remoteStream;
  });
  if (peerType.value === PeerType.LAUNCH) {
    launchExchangeSDP();
  }
};

// 启动SDP交换流程 - 建立Peer连接第一步，后面流程通过事件回调推动
const launchExchangeSDP = async () => {
  const offer = await peerConnection!.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });
  await peerConnection!.setLocalDescription(offer);
  socket.emit('sendOffer', offer);
};

onMounted(() => {
  initSignalingChannel();
  initMediaStream().catch((err) => {
    alert(err);
  });
});
</script>

<style lang="less" scoped>
.home-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  .local-video {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0px;
    left: 0px;
    background-color: #333333;
    &.connect {
      width: 100px;
      height: 150px;
      top: 10px;
      right: 10px;
      left: unset;
      z-index: 2;
    }
  }
  .remote-video {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0px;
    right: 0px;
    z-index: 1;
    background-color: #333333;
  }
  .video-el {
    width: 100%;
    height: 100%;
  }
  .call-btn {
    width: 150px;
    height: 150px;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    border-radius: 50%;
    background-color: #50c878;
    display: flex;
    justify-content: center;
    align-items: center;
    color: #dddddd;
    font-weight: bold;
    box-shadow: 0px 0px 20px rgba(80, 200, 120, 0.5);
    transition: all 0.1s;
    &:active {
      transform: translate(-50%, -50%) scale(0.95);
    }
    &.disabled {
      background-color: #999999;
      transform: translate(-50%, -50%);
      box-shadow: none;
    }
  }
  .action-area {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    align-items: center;
    .action-btn {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      color: #dddddd;
      font-size: 26px;
      & + .action-btn {
        margin-left: 30px;
      }
      &.accept-btn {
        background-color: #50c878;
        &:active {
          background-color: lighten(#50c878, 5%);
        }
      }
      &.reject-btn {
        background-color: #ee4b2b;
        &:active {
          background-color: lighten(#ee4b2b, 5%);
        }
      }
    }
  }
  .center-tip {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    color: #dddddd;
  }
  .msg {
    width: 100%;
    padding: 6px 10px;
    position: absolute;
    top: 0px;
    left: 0px;
    z-index: 3;
    background-color: #4169e1;
    color: #dddddd;
    font-size: 12px;
    text-align: center;
  }
}
</style>
