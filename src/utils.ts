
export class BufferedWebsocket implements WebSocket {
    ws!: WebSocket

    private _url: string
    private _protocols: string | string[] | undefined
    private bufferedSends: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = []
    private eventListeners: Map<string, { listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions }[]> = new Map()
    private reconnectHandle: number | null = null
    private reconnectTimeout = 0

    get url() { return this._url }
    set url(v: string) {
        if (v !== this._url) {
            this._url = v
            this.performReconnect()
        }
    }

    get protocol(): string { return this.ws.protocol }
    get readyState(): number { return this.ws.readyState }

    get binaryType(): BinaryType { return this.ws.binaryType }
    set binaryType(binaryType: BinaryType) { this.ws.binaryType = binaryType }
    get bufferedAmount(): number { return this.ws.bufferedAmount }
    get extensions(): string { return this.ws.extensions }

    get CLOSED(): number { return this.ws.CLOSED }
    get CLOSING(): number { return this.ws.CLOSING }
    get CONNECTING(): number { return this.ws.CONNECTING }
    get OPEN(): number { return this.ws.OPEN }

    constructor(url: string, protocols?: string | string[]) {
        this._url = url
        this._protocols = protocols
        this.performReconnect()
    }

    onopen: ((this: WebSocket, ev: Event) => any) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent<any>) => any) | null = null
    onerror: ((this: WebSocket, ev: Event) => any) | null = null
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null

    addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        const listeners = this.eventListeners.get(type) ?? []
        listeners.push({ listener, options })
        this.eventListeners.set(type, listeners)

        // Don't bubble up close or error events in order to make reconnection 'seamless'
        if (type !== 'close' && type !== 'error')
            this.ws.addEventListener(type, listener, options)
    }

    removeEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any, options?: boolean | EventListenerOptions): void
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
        const listeners = this.eventListeners.get(type) ?? []
        const index = listeners.findIndex(l => l.listener === listener && (l.options === options || (typeof l.options === 'object' && typeof options === 'object' && l.options.capture === options.capture)))
        if (index >= 0) listeners.splice(index, 1)
        this.ws.removeEventListener(type, listener, options)
    }

    dispatchEvent(event: Event): boolean {
        return this.ws.dispatchEvent(event)
    }

    close(code?: number, reason?: string): void {
        this.ws.close(code, reason)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.ws.readyState === this.ws.OPEN) {
            this.ws.send(data)
        } else {
            this.bufferedSends.unshift(data)
        }
    }

    private performReconnect() {
        try {
            const prev: WebSocket | undefined = this.ws
            if (prev && prev.readyState === prev.OPEN) prev.close(3012, 'Reconnecting')

            // Terrible hack to guarantee that the first websocket will always be instantiated successfully
            const next = new WebSocket(prev ? this._url : 'wss://echo.websocket.org', this._protocols)

            next.binaryType = prev?.binaryType ?? next.binaryType
            next.onopen = prev?.onopen ?? next.onopen
            next.onmessage = prev?.onmessage ?? next.onmessage
            next.onerror = prev?.onerror ?? next.onerror
            next.onclose = prev?.onclose ?? next.onclose

            this.ws = next
            if (!prev) this.reconnect()

            for (const [type, listeners] of this.eventListeners.entries()) {
                for (const listener of listeners) {
                    if (prev) prev.removeEventListener(type, listener.listener, listener.options)
                    next.addEventListener(type, listener.listener, listener.options)
                }
            }
            next.addEventListener('open', ev => {
                if (next !== this.ws) {
                    next.close(3012, 'Reconnecting')
                    return
                }
                this.reconnectTimeout = 0
                this.onopen?.(ev)
                while (this.bufferedSends.length) next.send(this.bufferedSends.pop()!)
            })
            next.addEventListener('message', ev => {
                this.onmessage?.(ev)
            })
            next.addEventListener('error', ev => {
                this.onerror?.(ev)
            })
            next.addEventListener('close', ev => {
                this.onclose?.(ev)
                if (next === this.ws) {
                    this.reconnect()
                }
            })
        } catch (e) {
            console.error(e)
            this.reconnect()
        }
    }

    reconnect() {
        if (this.reconnectHandle) {
            clearTimeout(this.reconnectHandle)
            this.reconnectHandle = null
        }
        this.reconnectHandle = window.setTimeout(() => this.performReconnect(), this.reconnectTimeout)
        this.reconnectTimeout = Math.min(32000, Math.max(1000, this.reconnectTimeout) * 2)
    }
}
