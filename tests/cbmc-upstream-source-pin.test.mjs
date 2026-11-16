import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/cbmc.sh", "utf8");

test("CBMC 6.11.0 builder pins the official Ubuntu 24.04 release asset", () => {
  assert.match(builder, /FT_UPSTREAM_ASSET_ID=523196902/);
  assert.match(builder, /FT_UPSTREAM_SHA256="b3721aa541038384d7801ea3aeabbcddc3e8845ac8f1cbff637cf8dec7481ac8"/);
  assert.match(builder, /FT_UPSTREAM_SIZE=73477756/);
  assert.match(builder, /FT_UPSTREAM_URL="https:\/\/github\.com\/diffblue\/cbmc\/releases\/download\/cbmc-6\.11\.0\/ubuntu-24\.04-cbmc-6\.11\.0-Linux\.deb"/);
});

test("upstream SHA256 and byte size are checked before Debian extraction", () => {
  const sha = builder.indexOf('actual_sha256=$(sha256sum "$deb"');
  const size = builder.indexOf("actual_size=$(stat -c '%s' \"$deb\")");
  const shaGuard = builder.indexOf('[ "$actual_sha256" = "$FT_UPSTREAM_SHA256" ] || ft::die');
  const sizeGuard = builder.indexOf('[ "$actual_size" = "$FT_UPSTREAM_SIZE" ] || ft::die');
  const extract = builder.indexOf('ft::deb_extract "$deb" /tmp/cbmcx');
  assert.ok(sha >= 0 && size >= 0 && shaGuard >= 0 && sizeGuard >= 0 && extract >= 0);
  assert.ok(sha < shaGuard && size < sizeGuard);
  assert.ok(shaGuard < extract && sizeGuard < extract);
});

test("missing or mismatched upstream identity fails closed", () => {
  assert.match(builder, /SHA256 could not be computed/);
  assert.match(builder, /size could not be read/);
  assert.match(builder, /SHA256 mismatch/);
  assert.match(builder, /size mismatch/);
});
