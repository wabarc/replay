import { LitElement, html, css } from "lit";
import { wrapCss, IS_APP } from "./misc";

import prettyBytes from "pretty-bytes";

import { parseURLSchemeHostPath } from "./pageutils";


// ===========================================================================
class Loader extends LitElement
{
  constructor() {
    super();
    this.progress = 0;
    this.total = 0;
    this.percent = 0;
    this.coll = "";
    this.state = "waiting";
    this.loadInfo = null;

    this.currentSize = 0;
    this.totalSize = 0;

    this.tryFileHandle = !!window.showOpenFilePicker;

    this.fileHandle = null;

    this.errorAllowRetry = false;

    this.pingInterval = "";
  }

  static get properties() {
    return {
      sourceUrl: { type: String },
      loadInfo: { type: Object },
      state: { type: String },
      progress: { type: Number },
      percent: { type: Number },
      currentSize: { type: Number },
      totalSize: { type: Number },
      error: { type: String},
      total: { type: Number },
      status: { type: String },
      coll: { type: String },
      embed: { type: String },
      tryFileHandle: { type: Boolean },
      errorAllowRetry: { type: Boolean }
    };
  }

  firstUpdated() {
    this.initMessages();
    //this.doLoad();
  }

  initMessages() {
    if (!navigator.serviceWorker) {
      return;
    }

    navigator.serviceWorker.addEventListener("message", (event) => {
      switch (event.data.msg_type) {
      case "collProgress":
        if (event.data.name === this.coll) {
          this.percent = event.data.percent;
          if (event.data.error) {
            this.error = event.data.error;
            this.state = "errored";
            this.errorAllowRetry = true;
            this.fileHandle = event.data.fileHandle;
            if (this.error === "missing_local_file") {
              this.tryFileHandle = false;
            } else if (this.error === "permission_needed" && event.data.fileHandle) {
              this.state = "permission_needed";
              break;
            }
          }
          if (event.data.currentSize && event.data.totalSize) {
            this.currentSize = event.data.currentSize;
            this.totalSize = event.data.totalSize;
          }
        }
        break;

      case "collAdded":
        if (event.data.name === this.coll) {
          if (!this.total) {
            this.total = 100;
          }
          this.progress = this.total;
          this.percent = 100;
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
          }
          this.dispatchEvent(new CustomEvent("coll-loaded", {detail: event.data}));
        }
        break;
      }
    });
  }

  async doLoad() {
    let sourceUrl = this.sourceUrl;
    let source = null;

    this.percent = this.currentSize = this.totalSize = 0;

    if (!navigator.serviceWorker) {
      this.state = "errored";
      if (window.location.protocol === "http:") {
        this.error = `\
Sorry, the ReplayWeb.page system must be loaded from an HTTPS URL, but was loaded from: ${window.location.host}.
Please try loading this page from an HTTPS URL`;
      } else {
        this.error = "Sorry, this browser is not supported. Please try a different browser\n(If you're using Firefox, try without Private Mode)";
      }
      this.errorAllowRetry = false;
      return;
    }

    // custom protocol handlers here...
    try {
      const {scheme, host, path} = parseURLSchemeHostPath(sourceUrl);

      switch (scheme) {
      case "googledrive":
        this.state = "googledrive";
        source = await this.googledriveInit();
        break;

      case "s3":
        source = {sourceUrl,
          loadUrl: `https://${host}.s3.amazonaws.com${path}`,
          name: this.sourceUrl};
        break;

      case "file":
        if (!this.loadInfo && !this.tryFileHandle) {
          this.state = "errored";
          this.error = `\
File URLs can not be entered directly or shared.
You can select a file to upload from the main page by clicking the 'Choose File...' button.`;
          this.errorAllowRetry = false;
          return;
        }

        source = this.loadInfo;
        break;

      case "ipfs":
        if (IS_APP) {
          // eslint-disable-next-line no-undef
          const url = new URL(__APP_FILE_SERVE_PREFIX__);
          const hash = sourceUrl.split("#", 1)[0];
          url.searchParams.set("ipfs", hash.slice("ipfs://".length));
          source = {sourceUrl, loadUrl: url.href};
        }
        break;
      }
    } catch (e) {
      console.log(e);
    }

    if (!source) {
      source = {sourceUrl};
    }

    source.newFullImport = (this.loadInfo && this.loadInfo.newFullImport);

    this.state = "started";

    const msg = {"msg_type": "addColl", "name": this.coll, skipExisting: true, file: source};

    if (this.loadInfo && this.loadInfo.extraConfig) {
      msg.extraConfig = this.loadInfo.extraConfig;
    }

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve());
      });
    }

    navigator.serviceWorker.controller.postMessage(msg);

    // ping service worker with messages to avoid shutdown while loading
    // (mostly for Firefox)
    this.pingInterval = setInterval(() => {
      navigator.serviceWorker.controller.postMessage({"msg_type": "ping"});
    }, 15000);
  }

  googledriveInit() {
    this._gdWait = new Promise((resolve) => this._gdResolve = resolve);
    return this._gdWait;
  }

  async onLoadReady(event) {
    if (this._gdResolve) {
      //const digest = await digestMessage(url, 'SHA-256');
      //this.coll = "id-" + digest.slice(0, 12);

      this._gdResolve(event.detail);
    }
  }

  onCancel() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({"msg_type": "cancelLoad", "name": this.coll});
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
      }
    }
  }

  updated(changedProperties) {
    if (this.sourceUrl && changedProperties.has("sourceUrl") || changedProperties.has("tryFileHandle")) {
      this.doLoad();
    }
  }

  static get styles() {
    return wrapCss(css`
      :host {
        height: 100%;
        display: flex;
      }

      .logo {
        width: 96px;
        height: 96px;
        margin: 1em;
        flex-grow: 1;
      }

      .progress-div {
        position: relative;
        width: 400px !important;
      }

      .progress-label {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        font-size: calc(1.5rem / 1.5);
        line-height: 1.5rem;
      }

      .loaded-prog {
        margin-bottom: 1em;
      }

      .error {
        white-space: pre-wrap;
        margin-bottom: 2em;
      }

      section.container {
        margin: auto;
      }
    `);
  }

  render() {
    return html`
    <section class="container">
      <div class="has-text-centered is-flex">
        <wr-anim-logo class="logo" size="96px"/>
      </div>
      ${!this.embed ? html`
      <div class="level">
        <p class="level-item">Loading&nbsp;<b>${this.sourceUrl}</b>...</p>
      </div>` : ""}
      <div class="level">
        <div class="level-item has-text-centered">
        ${this.renderContent()}
        </div>
      </div>
    </section>
    `;
  }

  renderContent() {
    switch (this.state) {
    case "googledrive":
      return html`<wr-gdrive .sourceUrl=${this.sourceUrl} @load-ready=${this.onLoadReady}/>`;

    case "started":
      return html`
          <div class="progress-div">
            <progress id="progress" class="progress is-primary is-large" 
            value="${this.percent}" max="100"></progress>
            <label class="progress-label" for="progress">${this.percent}%</label>
            ${this.currentSize && this.totalSize ? html`
              <p class="loaded-prog">Loaded <b>${prettyBytes(this.currentSize)}</b> of <b>${prettyBytes(this.totalSize)}</b></p>` : html``}

            ${!this.embed ? html`
            <button @click="${this.onCancel}" class="button is-danger">Cancel</button>` : ""}
          </div>`;

    case "errored":
      return html`
          <div class="has-text-left">
          <div class="error has-text-danger">${this.error}</div>
          <div>
          ${this.errorAllowRetry ? html`
          <a class="button is-warning" @click=${() => window.parent.location.reload()}>Try Again</a>` : ""}
          ${this.embed ? html`` : html`
          <a href="/" class="button is-warning">Back</a>`}
          </div>`;

    case "permission_needed":
      return html`
        <div class="has-text-left">
          <div class="">Permission is needed to reload the archive file. (Click <i>Cancel</i> to cancel loading this archive.)</div>
          <button @click="${this.onAskPermission}" class="button is-primary">Show Permission</button>
          <a href="/" class="button is-danger">Cancel</a>
        </div>`;

    case "waiting":
    default:
      return html`<progress class="progress is-primary is-large" style="max-width: 400px"/>`;

    }
  }

  async onAskPermission() {
    const result = await this.fileHandle.requestPermission({mode: "read"});
    if (result === "granted") {
      this.doLoad();
    }
  }
}

customElements.define("wr-loader", Loader);

export { Loader };
