const localVideoTag = document.querySelector('video#local');
const remoteVideoTag = document.querySelector('video#remote');
const middleVideoTag = document.querySelector('video#middle');



let localStream;
let remoteStream;

let startToMiddle;
let startToEnd;

const supportsInsertableStreamsLegacy = !!RTCRtpSender.prototype.createEncodedVideoStreams;
const supportsInsertableStreams = !!RTCRtpSender.prototype.createEncodedStreams;

let supportsTransferableStreams = false;
try {
  const stream = new ReadableStream();
  window.postMessage(stream, '*', [stream]);
  supportsTransferableStreams = true;
} catch (e) {
  console.error('Transferable streams are not supported.');
}

if (!!window.Worker) {
  console.error('Worker supported.');
} else {
  console.error('Worker not supported.');

}

if (!((supportsInsertableStreams || supportsInsertableStreamsLegacy) && supportsTransferableStreams)) {
  banner.innerText = 'Your browser does not support Insertable Streams. ' +
    'This sample will not work.';
}

function gotLocalStream(stream) {
  console.log('Received local stream');
  localVideoTag.srcObject = stream;
  localStream = stream;
}

function gotRemoteStream(stream) {
  console.log('Received remote stream');
  remoteStream = stream;
  remoteVideoTag.srcObject = stream;
}

function start() {
  console.log('Requesting local stream');
  const options = {
    audio: true,
    video: { width: 480, height: 360 }
  };
  navigator.mediaDevices
    .getUserMedia(options)
    .then(gotLocalStream)
    .catch(function(e) {
      alert('getUserMedia() failed');
      console.log('getUserMedia() error: ', e);
    });
}

function call() {
  console.log('Starting call');

  startToMiddle = new VideoPipe(localStream, true, false, e => {
    middleVideoTag.srcObject = e.streams[0];
  });
  startToMiddle.pc1.getSenders().forEach(s => {
    console.log(s);
    setupSenderTransform(s)
  });
  startToMiddle.negotiate();

  startToEnd = new VideoPipe(localStream, true, true, e => {
    setupReceiverTransform(e.receiver);
    gotRemoteStream(e.streams[0]);
  });
  startToEnd.pc1.getSenders().forEach(setupSenderTransform);
  startToEnd.negotiate();

  console.log('Video pipes created');
}

function hangup() {
  console.log('Ending call');
  startToMiddle.close();
  startToEnd.close();
}


function toggleMute(event) {
  video2.muted = muteMiddleBox.checked;
  videoMonitor.muted = !muteMiddleBox.checked;
}


function setupSenderTransform(sender) {
  let senderStreams;

  senderStreams = sender.createEncodedStreams();

  const readableStream = senderStreams.readable || senderStreams.readableStream;
  const writableStream = senderStreams.writable || senderStreams.writableStream;

  const transformStream = new TransformStream({
    transform: encodeFunction,
  });

  readableStream
    .pipeThrough(transformStream)
    .pipeTo(writableStream);
}

function encodeFunction(encodedFrame, controller) {

  console.log("[ENCODE]: ", encodedFrame.data);

  const view = new DataView(encodedFrame.data);
  // Any length that is needed can be used for the new buffer.
  const newData = new ArrayBuffer(encodedFrame.data.byteLength + 5);
  const newView = new DataView(newData);

  const cryptoOffset = frameTypeToCryptoOffset[encodedFrame.type];

  let frameByteLength = encodedFrame.data.byteLength

  for (let i = 0; i < cryptoOffset && i < frameByteLength; ++i) {
    newView.setInt8(i, view.getInt8(i));
  }
  for (let i = cryptoOffset; i < encodedFrame.data.byteLength; ++i) {
    newView.setInt8(i, view.getInt8(i) + 1);
  }


  encodedFrame.data = newData;
  console.log("[ENCODE] result: ", newData);

  controller.enqueue(encodedFrame);
}


function setupReceiverTransform(receiver) {
  let receiverStreams;
  receiverStreams = receiver.createEncodedStreams();

  const readableStream = receiverStreams.readable || receiverStreams.readableStream;
  const writableStream = receiverStreams.writable || receiverStreams.writableStream;

  const transformStream = new TransformStream({
    transform: decodeFunction,
  });
  readableStream
    .pipeThrough(transformStream)
    .pipeTo(writableStream);
}

function decodeFunction(encodedFrame, controller) {

  const view = new DataView(encodedFrame.data);
  console.log("[DECODE]: ", encodedFrame.data);

  const newData = new ArrayBuffer(encodedFrame.data.byteLength - 5);
  const newView = new DataView(newData);
  const cryptoOffset = frameTypeToCryptoOffset[encodedFrame.type];

  for (let i = 0; i < cryptoOffset; ++i) {
    newView.setInt8(i, view.getInt8(i));
  }
  for (let i = cryptoOffset; i < encodedFrame.data.byteLength - 5; ++i) {
    newView.setInt8(i, view.getInt8(i) - 1);

  }
  encodedFrame.data = newData;
  console.log("[DECODE]: result", newData);

  controller.enqueue(encodedFrame);
}

// If using crypto offset (controlled by a checkbox):
// Do not encrypt the first couple of bytes of the payload. This allows
// a middle to determine video keyframes or the opus mode being used.
// For VP8 this is the content described in
//   https://tools.ietf.org/html/rfc6386#section-9.1
// which is 10 bytes for key frames and 3 bytes for delta frames.
// For opus (where encodedFrame.type is not set) this is the TOC byte from
//   https://tools.ietf.org/html/rfc6716#section-3.1
//
// It makes the (encrypted) video and audio much more fun to watch and listen to
// as the decoder does not immediately throw a fatal error.
const frameTypeToCryptoOffset = {
  key: 10, // key frame (i frame)
  delta: 3, // delta frame (p, b frame - inter frame)
  undefined: 1,
};
