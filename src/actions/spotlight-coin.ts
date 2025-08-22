import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, JsonObject } from "@elgato/streamdeck";

interface TickerSettings extends JsonObject {
  symbol?: string;
  currency?: string;
  uiStyle?: "default" | "extended"; // toggle flag
}

interface Binance24hrTickerResponse {
	symbol: string;
	priceChange: string;
	priceChangePercent: string;
	weightedAvgPrice: string;
	prevClosePrice: string;
	lastPrice: string;
	lastQty: string;
	bidPrice: string;
	askPrice: string;
	openPrice: string;
	highPrice: string;
	lowPrice: string;
	volume: string;
	quoteVolume: string;
	openTime: number;
	closeTime: number;
	firstId: number;
	lastId: number;
	count: number;
}

@action({ UUID: "com.pawish.streamdeck-spotlight-coin.increment" })
export class SpotlightCoin extends SingletonAction<TickerSettings> {
  private currentStyle: Map<string, "default" | "extended"> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private lastUpdateTime: Map<string, number> = new Map();
  private cooldownMs = 1000;

  override async onKeyDown(ev: KeyDownEvent<TickerSettings>): Promise<void> {
    const actionId = ev.action.id;
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime.get(actionId) || 0;
    if (now - lastUpdate < this.cooldownMs) return;

    this.lastUpdateTime.set(actionId, now);
    const settings = ev.payload.settings as TickerSettings;
    const newStyle = settings.uiStyle === "extended" ? "default" : "extended";
    await ev.action.setSettings({ ...settings, uiStyle: newStyle });
    this.currentStyle.set(actionId, newStyle);
    await this.updatePrice(ev, newStyle);
  }

  override async onWillAppear(ev: WillAppearEvent<TickerSettings>): Promise<void> {
    const actionId = ev.action.id;
    const settings = await ev.action.getSettings() as TickerSettings;
    const style = settings.uiStyle || "default";
    this.currentStyle.set(actionId, style);
    this.lastUpdateTime.set(actionId, Date.now());
    await this.updatePrice(ev, style);
    this.startPolling(ev);
  }

  private startPolling(ev: WillAppearEvent<TickerSettings>) {
    const actionId = ev.action.id;
    if (this.intervals.has(actionId)) clearInterval(this.intervals.get(actionId)!);
    const interval = setInterval(async () => {
      const style = this.currentStyle.get(actionId) || "default";
      this.lastUpdateTime.set(actionId, Date.now());
      await this.updatePrice(ev, style);
    }, 60_000);
    this.intervals.set(actionId, interval);
  }

  private async updatePrice(ev: { action: any }, styleOverride?: "default" | "extended") {
	const actionId = ev.action.id;
	const settings = await ev.action.getSettings() as TickerSettings;
	const style = styleOverride || settings.uiStyle || "default";
  
	try {
	  const symbol = (settings.symbol || "BTCUSDT").toUpperCase();
	  const currency = symbol.replace("USDT", "").replace("USDC", "");
  
	  const [klinesRes, tickerRes] = await Promise.all([
		fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=10`),
		fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
	  ]);
  
	  // ✅ FIX 1: Use correct order for ticker parsing to ensure no async mismatch
	  const json = await tickerRes.json() as Binance24hrTickerResponse;
	  const rawPrice = parseFloat(json.lastPrice);
	  const priceChange = parseFloat(json.priceChange);
	  const priceChangePercent = parseFloat(json.priceChangePercent);

	  const highPrice = parseFloat(json.highPrice);
      const lowPrice = parseFloat(json.lowPrice);
      const avgPrice = parseFloat(json.weightedAvgPrice);
  
	  const klines = await klinesRes.json() as any[];
	  const dataPoints = klines.map((d: any) => parseFloat(d[4])); // Use close price
  
	  const currentPrice = this.formatPriceDynamic(rawPrice);
	  const changeStr = `${Math.abs(priceChangePercent).toFixed(2)}%`;
  
	  let arrow = "■", arrowColor = "#5c5c5c", tickerColor = "#4b4b4b";
	  if (priceChange > 0) {
		arrow = "▲"; arrowColor = "#34C759"; tickerColor = "#275C35";
	  } else if (priceChange < 0) {
		arrow = "▼"; arrowColor = "#FF3B30"; tickerColor = "#650212";
	  }
  
	  /*const svg = style === "extended"
		? this.buildExtendedSVG(currency, currentPrice, arrow, arrowColor, changeStr, tickerColor, dataPoints)
		: this.buildSVG(currency, currentPrice, arrow, arrowColor, changeStr, tickerColor, dataPoints);*/
  
	  const svg = style === "extended"
		? this.buildExtendedSVG(currency, currentPrice, arrow, arrowColor, changeStr, tickerColor, dataPoints, highPrice, lowPrice, avgPrice)
		: this.buildSVG(currency, currentPrice, arrow, arrowColor, changeStr, tickerColor, dataPoints);
	  

	  await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
	} catch (e) {
	  console.error("Update failed:", e);
	  const fallbackSVG = this.buildFallbackSVG();
	  await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(fallbackSVG)}`);
	}
  }

  private formatPriceDynamic(price: number): string {
    if (price >= 100000) return Math.round(price).toLocaleString();
    if (price >= 100) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) {
      const [intPart, decPart = ""] = price.toFixed(8).split(".");
      const availableDecimals = Math.max(0, 8 - intPart.length - 1);
      return parseFloat(`${intPart}.${decPart.slice(0, availableDecimals)}`).toLocaleString(undefined, {
        minimumFractionDigits: availableDecimals,
        maximumFractionDigits: availableDecimals
      });
    }
    return price.toFixed(8).replace(/(?:\.(\d*?[1-9]))0+$/g, ".$1").replace(/\.0+$/, "");
  }

	buildSVG(symbol: string, currentPrice: string, arrow: string, arrowColor: string, changeStr: string, tickerColor: string, dataPoints: number[]): string {
		const chartTop = 50, chartBottom = 70, chartHeight = chartBottom - chartTop, chartWidth = 80, pointCount = 10;
		const max = Math.max(...dataPoints);
		const min = Math.min(...dataPoints);
		const range = max - min || 1;
		const stepX = chartWidth / (pointCount - 1);
		const linePoints = dataPoints.map((v, i) => `${stepX * i},${chartBottom - ((v - min) / range) * chartHeight}`);
		const areaPoints = dataPoints.map((v, i) => `${stepX * i},${chartBottom - ((v - min) / range) * chartHeight}`);
		const firstX = 0;
		const lastX = stepX * (pointCount - 1);
		const area = [...areaPoints, `${lastX},${chartBottom + 50}`, `${firstX},${chartBottom + 50}`].join(" ");
		const line = linePoints.join(" ");

		const average = dataPoints.reduce((sum, val) => sum + val, 0) / dataPoints.length;
		const avgY = chartBottom - ((average - min) / range) * chartHeight;

		// Add vertical grid lines with hour labels above using chartTop and chartBottom
		const now = new Date();
		const latestHour = now.getHours() % 12 || 12;
		const hours = Array.from({ length: 5 }, (_, i) => {
			if (i === 3) return latestHour.toString();
			const d = new Date(now);
			d.setHours(d.getHours() - (9 - i * 3));
			const hour = d.getHours() % 12 || 12;
			return hour.toString();
		});

		const gridLines = hours.map((hour, i) => {
			const x = (100 / 4) * i;
			return `
				<text x="${x - 4}" y="${chartTop + 6}" font-size="12" fill="white" font-family="Arial" opacity="0.6">${hour}</text>
				<line x1="${x}" y1="${chartTop + 8}" x2="${x}" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />

			`;
		}).join("\n");


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
			
			${gridLines}

			<polygon points="${area}" fill="url(#areaGradient)" />
			<polyline points="${line}" fill="none" stroke="${arrowColor}" stroke-width="3" />
			<line x1="0" y1="${avgY}" x2="100" y2="${avgY}" stroke="${arrowColor}" stroke-width="2" stroke-dasharray="8,2" opacity="0.6" />

			<text x="6" y="20" font-size="17" font-weight="900" fill="white" font-family="Arial">${symbol}</text>
			<text x="6" y="42" font-size="17" font-weight="700" fill="white" font-family="Arial">${currentPrice}</text>
			<text x="6" y="88" font-size="17" font-weight="700" fill="${arrowColor}" font-family="Arial">${changeStr}</text>
			<text x="72" y="88" font-size="17" font-weight="900" fill="${arrowColor}" font-family="Arial">${arrow}</text>
		</svg>
		`;
	}

	buildExtendedSVG(symbol: string, currentPrice: string, arrow: string, arrowColor: string, changeStr: string, tickerColor: string, dataPoints: number[], high: number, low: number, avg: number): string {
		const chartLeft = 10, chartRight = 90;
		const range = high - low || 1;
		const priceX = (price: number) => chartLeft + ((price - low) / range) * (chartRight - chartLeft);
		const avgX = priceX(avg);
		const currentX = priceX(parseFloat(currentPrice.replace(/,/g, "")));
	
		return `
		<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#000000"/>
					<stop offset="30%" stop-color="#000000"/>
					<stop offset="100%" stop-color="${tickerColor}"/>
				</linearGradient>
			</defs>
			<rect width="100" height="100" fill="url(#grad)"/>
	
			<line y1="60" y2="76" x1="${avgX}" x2="${avgX}" stroke="white" stroke-width="2" opacity="0.2" />
			<line y1="60" y2="100" x1="${currentX}" x2="${currentX}" stroke="${arrowColor}" stroke-width="3" />
			<rect y="84" x="0" height="16" width="${currentX}" fill="${arrowColor}" />
			<rect y="84" x="0" height="16" width="100" fill="white" opacity="0.1" />
	
			<text x="6" y="20" font-size="17" font-weight="900" fill="white" font-family="Arial">${symbol}</text>
			<text x="6" y="42" font-size="17" font-weight="700" fill="white" font-family="Arial">${currentPrice}</text>
	
			<text x="8" y="72" font-size="12" font-weight="700" fill="white" font-family="Arial" opacity="0.6">L</text>
			<text x="76" y="72" font-size="12" font-weight="700" fill="white" font-family="Arial" opacity="0.6">H</text>
		</svg>
		`;
	}
	
	

	buildFallbackSVG(): string {
		const chartTop = 60, chartBottom = 70;

		return `
		<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
			<line x1="0" y1="${chartTop - 2}" x2="0" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />
			<line x1="25" y1="${chartTop - 2}" x2="25" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />
			<line x1="50" y1="${chartTop - 2}" x2="50" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />
			<line x1="75" y1="${chartTop - 2}" x2="75" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />
			<line x1="100" y1="${chartTop - 2}" x2="100" y2="${chartBottom + 50}" stroke="#ffffff" stroke-width="1" opacity="0.6" />

			<text x="6" y="24" font-size="17" font-weight="900" fill="white" font-family="Arial">--</text>
			<text x="6" y="42" font-size="17" font-weight="700" fill="white" font-family="Arial" opacity="0.6" >--.--</text>
			<text x="6" y="88" font-size="17" font-weight="700" fill="white" font-family="Arial" opacity="0.6" >--.--%</text>
			<text x="72" y="88" font-size="17" font-weight="900" fill="white" font-family="Arial" opacity="0.6" >■</text>
		</svg>
		`;
	}

	override onWillDisappear(ev: WillDisappearEvent<TickerSettings>) {
		const actionId = ev.action.id;
		if (this.intervals.has(actionId)) {
		  clearInterval(this.intervals.get(actionId)!);
		  this.intervals.delete(actionId);
		}
		this.currentStyle.delete(actionId);
		this.lastUpdateTime.delete(actionId);
	}
}


