'use strict';
/* Public surface for the host harness and the smoke simulator. */

const { createGateway, PROTOCOL_VERSION, UPLINK_BYTES, AUDIO_FRAME_BYTES, AUDIO_HEADER_LENGTH } = require('./server');
const { connect } = require('./ws-client');
const { MockUpstream, createUpstream, synthPcm, FORMAT, OpenAICompatibleUpstream } = require('./upstream');
const { encodeFrame, parseFrames } = require('./ws');

module.exports = {
  createGateway, connect,
  MockUpstream, createUpstream, synthPcm, FORMAT, OpenAICompatibleUpstream,
  encodeFrame, parseFrames,
  PROTOCOL_VERSION, UPLINK_BYTES, AUDIO_FRAME_BYTES, AUDIO_HEADER_LENGTH
};
