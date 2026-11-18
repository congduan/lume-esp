// r106: deploy-manifest firmware API tag query.
//
// The CLI asks the connected device for its LUME_API_TAG over the LUMC command
// channel and stamps the answer into each app's meta.json "fw" field. Keeping
// this in its own module (rather than in lume.js) lets both the CLI and the
// unit tests import it without running the CLI's top-level argv parsing.
import { simpleCommand, FWTAG_CMD } from './protocol.js';

/**
 * Read the device's firmware API tag (FWTAG -> "CMD OK fwt <TAG>").
 * Throws on any failure so callers can report it honestly -- a tag value is
 * never invented. Firmware without FWTAG answers "CMD ERR verb", which is
 * surfaced as a clear "update the firmware" error.
 */
export async function queryFirmwareTag(device) {
  let reply;
  try {
    reply = await device.command(simpleCommand(FWTAG_CMD));
  } catch (err) {
    throw new Error(`cannot query device firmware tag (${err.message}); ` +
                    `update the firmware to a build that supports FWTAG`);
  }
  const tag = reply && reply.arg;
  if (!tag || reply.verb !== 'fwt' || !/^\d+$/.test(tag)) {
    throw new Error(`unexpected FWTAG reply from device: ${JSON.stringify(reply)}`);
  }
  return Number(tag);
}
