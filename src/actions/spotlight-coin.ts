import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, JsonObject } from "@elgato/streamdeck";

interface SpotlightSettings extends JsonObject {
	symbol?: string;
	hours?: number;
}

@action({ UUID: "com.pawish.streamdeck-spotlight-coin.increment" })
export class SpotlightCoin extends SingletonAction<SpotlightSettings> {
	private intervals: Map<string, NodeJS.Timeout> = new Map();
	private action: Map<string, WillAppearEvent<SpotlightSettings>> = new Map();
	private lastData: Map<string, { symbol: string; currentPrice: string; arrow: string; arrowColor: string; changeStr: string; tickerColor: string }> = new Map();
	private lastKeyPressTime: Map<string, number> = new Map();

	override async onWillAppear(ev: WillAppearEvent<SpotlightSettings>) {
		const actionId = ev.action.id;
		this.action.set(actionId, ev);
		if (this.intervals.has(actionId)) clearInterval(this.intervals.get(actionId)!);
		await this.updatePrice(ev);
		const intervalId = setInterval(async () => {
			const currentAction = this.action.get(actionId);
			if (currentAction) await this.updatePrice(currentAction);
		}, 60 * 1000);
		this.intervals.set(actionId, intervalId);
	}

	override async onKeyDown(ev: KeyDownEvent<SpotlightSettings>): Promise<void> {
		const actionId = ev.action.id;
		const now = Date.now();
		const lastPressed = this.lastKeyPressTime.get(actionId) || 0;
		if (now - lastPressed >= 60 * 1000) {
			this.lastKeyPressTime.set(actionId, now);
			await this.updatePrice(ev);
		} else {
			console.log(`[SKIPPED] Button pressed within 1 minute interval: ${actionId}`);
		}
	}

	override async onDidReceiveSettings(ev: any) {
		const actionId = ev.action.id;
		this.action.set(actionId, ev);
		await this.updatePrice(ev);
	}

	private async fetchKlines(symbol: string): Promise<number[]> {
		const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=10`);
		const data = await res.json();
		if (!Array.isArray(data) || data.length < 10) throw new Error("Invalid kline data");
		return data.map((d: any) => parseFloat(d[4])); // Close prices
	}

	async updatePrice(ev: WillAppearEvent<SpotlightSettings> | any) {
		const actionId = ev.action.id;
		try {
			const settings = ev.payload?.settings || {};
			const symbol = (settings.symbol || "BTCUSDT").toUpperCase();
			const currency = symbol.replace("USDT", "").replace("USDC", "");
			const hours = Number(settings.hours || 3);

			const closePrices = await this.fetchKlines(symbol);
			const open = closePrices[0];
			const close = closePrices[closePrices.length - 1];
			const change = close - open;
			const percent = (change / open) * 100;

			const priceStr = close.toFixed(2);
			let arrow = "■", arrowColor = "#5c5c5c", tickerColor = "#4b4b4b";
			let changeStr = `${Math.abs(percent).toFixed(2)}%`;
			if (change > 0) {
				arrow = "▲";
				arrowColor = "#34C759";
				tickerColor = "#275C35";
			} else if (change < 0) {
				arrow = "▼";
				arrowColor = "#FF3B30";
				tickerColor = "#650212";
			}

			this.lastData.set(actionId, { symbol: currency, currentPrice: priceStr, arrow, arrowColor, changeStr, tickerColor });
			const svg = this.buildSVG(currency, priceStr, arrow, arrowColor, changeStr, tickerColor, closePrices);
			await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
		} catch (e) {
			const fallback = this.lastData.get(actionId);
			if (fallback) {
				const svg = this.buildSVG(fallback.symbol, fallback.currentPrice, fallback.arrow, fallback.arrowColor, fallback.changeStr, fallback.tickerColor, []);
				await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
			} else {
				await ev.action.setTitle("Error");
			}
			console.error("Ticker Fetch Failed:", e);
		}
	}

	buildSVG(symbol: string, currentPrice: string, arrow: string, arrowColor: string, changeStr: string, tickerColor: string, dataPoints: number[]): string {
		const chartTop = 64, chartBottom = 88, areaBottom = 120, chartHeight = chartBottom - chartTop, chartWidth = 100, pointCount = 10;
		const max = Math.max(...dataPoints);
		const min = Math.min(...dataPoints);
		const range = max - min || 1;
		const stepX = chartWidth / (pointCount - 1);
		const linePoints = dataPoints.map((v, i) => `${stepX * i},${chartBottom - ((v - min) / range) * chartHeight}`);
		const areaPoints = dataPoints.map((v, i) => `${stepX * i},${chartBottom - ((v - min) / range) * chartHeight}`);
		const firstX = 0;
		const lastX = stepX * (pointCount - 1);
		const area = [...areaPoints, `${lastX},${areaBottom}`, `${firstX},${areaBottom}`].join(" ");
		const line = linePoints.join(" ");

		return `
		<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="${tickerColor}" />
					<stop offset="100%" stop-color="#000000" />
				</linearGradient>
				<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#000000"/>
					<stop offset="30%" stop-color="#000000"/>
					<stop offset="100%" stop-color="${tickerColor}"/>
				</linearGradient>
			</defs>

			<polygon points="${area}" fill="url(#areaGradient)" />
			<polyline points="${line}" fill="none" stroke="${arrowColor}" stroke-width="4" />
			<text x="6" y="24" font-size="24" font-weight="900" fill="white" font-family="Arial">${symbol}</text>
			<text x="6" y="50" font-size="17" font-weight="700" fill="white" font-family="Arial">${currentPrice}</text>
			<text x="6" y="88" font-size="17" font-weight="700" fill="${arrowColor}" font-family="Arial">${changeStr}</text>
		</svg>
		`;
	}

	override onWillDisappear(ev: WillDisappearEvent<SpotlightSettings>) {
		const actionId = ev.action.id;
		if (this.intervals.has(actionId)) {
			clearInterval(this.intervals.get(actionId)!);
			this.intervals.delete(actionId);
		}
		this.action.delete(actionId);
		this.lastData.delete(actionId);
	}
}
