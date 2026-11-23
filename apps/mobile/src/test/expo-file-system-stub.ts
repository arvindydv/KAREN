/** Jest stand-in for expo-file-system (native). */
export class File {
  uri: string;
  exists = false;
  constructor(...parts: unknown[]) {
    this.uri = parts.map(String).join('/');
  }
  create() {}
  delete() {}
  async write() {}
  async bytes() {
    return new Uint8Array();
  }
}
export const Paths = { cache: 'file:///cache', document: 'file:///document' };
