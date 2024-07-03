const noble = require("@abandonware/noble");

function hslToRgb(h, s, l) {
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    var hue2rgb = function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function convert8bitTo16bitInt(num) {
  return Math.floor((num / 255) * 65535)
}

function intTo16BitHex(num) {
  return num.toString(16).padStart(2, '0');
}

function getLevelHex(level) {
  const baseHex = [
    '0110E1', '0CD124', '14D12E', '1650EF', '1B912A', '1E5129',
    '225138', '2910FF', '2A50FE', '3250F4', '3D10F0', '4910D7',
    '4E5115', '58D0DB', '5A511A', '64D0CA'
  ];

  const thresholds = [1, 11, 19, 21, 26, 29, 34, 40, 42, 50, 61, 73, 78, 88, 90, 100];

  for (let i = 0; i < thresholds.length; i++) {
    if (level <= thresholds[i]) {
      return baseHex[i];
    }
  }

  return '000000'; // Default case, shouldn't be reached normally
}

module.exports = class Device {
  constructor(uuid, log) {
    this.uuid = uuid;
    this.log = log;
    this.connected = false;
    this.power = false;
    this.brightness = 0;
    this.hue = 0;
    this.saturation = 0;
    this.l = 0.5;
    this.peripheral = undefined;

    noble.on("stateChange", (state) => {
      if (state == "poweredOn") {
        noble.startScanningAsync();
      } else {
        if (this.peripheral) this.peripheral.disconnect();
        this.connected = false;
      }
    });

    noble.on("discover", async (peripheral) => {
      this.log(peripheral.uuid, peripheral.advertisement.localName);
      if (peripheral.uuid == this.uuid) {
        this.log('Found:', peripheral.advertisement.localName, peripheral.uuid);
        this.peripheral = peripheral;
        noble.stopScanning();
        await this.connectAndGetWriteCharacteristics();
      }
    });
  }

  async connectAndGetWriteCharacteristics() {
    if (!this.peripheral) {
      return noble.startScanningAsync();
    }
    this.log.info(`Connecting to ${this.peripheral.uuid}...`);
    await this.peripheral.connectAsync().catch(error => {
      this.log.error(error)
    });

    const { characteristics } =
      await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
        ["0000e02600001000800000805f9b34fb"]
      );
    this.connected = characteristics[1] ? true : false;
    if (this.connected) {
      this.log.info('Connected with these properties:', characteristics[1].properties)
    } else {
      this.log.warn('Not connectected.', characteristics)
    }
    this.characteristic = characteristics[1];
  }

  async debounceDisconnect() {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (this.peripheral) {
          this.log("Disconnecting...");
          await this.peripheral.disconnectAsync();
          this.log("Disconnected");
          this.connected = false;
        }
      }, 5000);
    };
  }

  // Power state is A011 XXXX XXXX
  async set_power(status) {
    if (!this.connected) await this.connectAndGetWriteCharacteristics();
    try {
      const buffer = Buffer.from(
        `A01104${status ? '01B121' : '0070E1'}`,
        'HEX'
      );
      this.log(buffer, buffer.toString('utf8'));
      let write = await this.characteristic.writeAsync(buffer, false);
      this.power = status;
      // if (!status) {
      //   await this.peripheral.disconnectAsync()
      // }
    } catch (error) {
      this.log.error(error)
    }
  }

  // Brightness is A013 XXXX XXXX
  async set_brightness(level) {
    if (!this.connected) await this.connectAndGetWriteCharacteristics();
    try {
      const buffer = Buffer.from(`A01304${getLevelHex(level)}`, "hex");
      this.log(buffer);
      let write = await this.characteristic.writeAsync(buffer, false);
    } catch (error) {
      this.log.error(error)
    }
  }
  // Color is A015 XXXX XXXX XXXX
  async set_rgb(r, g, b) {
    if (!this.connected) await this.connectAndGetWriteCharacteristics();
    try {

      // this.log(r16, g16, b16)

      // let rHex = intTo16BitHex(r);
      // let gHex = intTo16BitHex(g);
      // let bHex = intTo16BitHex(b);
      this.log('RGB:', r, g, b);
      // hexCode appears to be RGB appears to RRGGBB + 4 bytes/character that have not been identified
      let hexCode = 'F7EDFFA912'; // Default to white
      if (r > 50 && g < 50 && b < 50) {
        hexCode = 'FF000025C0' // Red
      }
      if (r < 50 && g > 50 && b < 50) {
        hexCode = '00FF005400' // Green
      }
      if (r < 50 && g < 50 && b > 50) {
        hexCode = '0000FF55B0' // Blue
      }
      if (r < 50 && g > 50 && b > 50) {
        hexCode = '00FFFF1440' // Cyan
      }
      if (r > 50 && g > 50 && b < 50) {
        hexCode = 'FFFF006430' // Yellow
      }
      if (r > 128 && g < 50 && b > 128) {
        hexCode = '80008015B8' // Purple
      }
      hexCode = 'A01506' + hexCode;

      // Set two scenes  based on pre-defined colors
      if (r === 143 && g === 112 && b === 119) {
        hexCode = 'A01205C000E160' // Night Scene
      }
      if (r === 129 && g === 126 && b === 126) {
        hexCode = 'A01205C100E0F0' // Reading Scene
      }

      const buffer = Buffer.from(`${hexCode}`, "hex");
      this.log(buffer);
      let write = await this.characteristic.writeAsync(buffer, false);
    } catch (error) {
      this.log.error(error)
    }
  }

  async set_hue(hue) {
    if (!this.connected) await this.connectAndGetWriteCharacteristics();
    try {
      this.hue = hue;
      const rgb = hslToRgb(hue / 360, this.saturation / 100, this.l);
      this.set_rgb(rgb[0], rgb[1], rgb[2]);
    } catch (error) {
      this.log.error(error)
    }
  }

  async set_saturation(saturation) {
    if (!this.connected) await this.connectAndGetWriteCharacteristics();
    try {
      this.saturation = saturation;
      const rgb = hslToRgb(this.hue / 360, saturation / 100, this.l);
      this.set_rgb(rgb[0], rgb[1], rgb[2]);
    } catch (error) {
      this.log.error(error)
    }
  }
};
