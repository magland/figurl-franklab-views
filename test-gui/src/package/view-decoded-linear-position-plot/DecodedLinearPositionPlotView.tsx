import { DefaultToolbarWidth, TimeScrollView, TimeScrollViewPanel, usePanelDimensions, useRecordingSelectionTimeInitialization, useTimeRange, useTimeseriesMargins } from '@figurl/timeseries-views'
import { Checkbox } from '@material-ui/core'
import { FunctionComponent, useCallback, useMemo, useState } from 'react'
import { inferno, magma, plasma, viridis } from 'scale-color-perceptual'
import { ValidColorMap } from '../view-track-position-animation/TPADecodedPositionLayer'
import { DecodedLinearPositionPlotData } from './DecodedLinearPositionPlotViewData'
// import { TimeseriesLayoutOpts } from '@figurl/timeseries-views'
const COLOR_MAP_CHOICE: ValidColorMap | undefined = 'viridis'

// THIS SHOULD BE AN IMPORT FROM TIMESERIES-VIEWS
type TimeseriesLayoutOpts = {
    hideToolbar?: boolean
    hideTimeAxis?: boolean
    useYAxis?: boolean
}

type DecodedLinearPositionProps = {
    data: DecodedLinearPositionPlotData
    timeseriesLayoutOpts?: TimeseriesLayoutOpts
    width: number
    height: number
}

type PanelProps = {
    offscreenCanvas?: HTMLCanvasElement
}

const panelSpacing = 4
const emptyPanelSelection = new Set<number | string>()

// We will potentially be doing this a lot, and supposedly the good old for-loop is more
// performant than doing array-copy slicing and/or fancy reduce tricks.
const sumRange = (array: number[], startInclusive: number, endExclusive: number): number => {
    let end = Math.min(endExclusive, array.length) || 0
    let res = 0
    for (let i = startInclusive; i < end; i++) {
        res += array[i]
    }
    return res
}


type DownsampledData = {
    downsampledValues: number[],
    downsampledPositions: number[],
    downsampledTimes: number[]
}
/*
// Currently unused. Would dynamically fit the visible time points into the available onscreen canvas.
const dynamicDownsample = (values: number[], positions: number[], times: number[], framesPerPixel: number): DownsampledData => {
    let runningTimeIndexTotal = 0
    let nextUnprocessedTimeIndex = 0
    let nextUnprocessedDataIndex = 0
    const results: DownsampledData = { downsampledValues: [], downsampledPositions: [], downsampledTimes: [] }
    while (runningTimeIndexTotal < times.length) {
        runningTimeIndexTotal += framesPerPixel
        const thisFrameLength = Math.floor(runningTimeIndexTotal - nextUnprocessedTimeIndex)
        const dataIndicesThisChunk = sumRange(times, nextUnprocessedTimeIndex, nextUnprocessedTimeIndex + thisFrameLength + 1)
        const chunkData: Map<number, number> = new Map()
        for (let i = nextUnprocessedDataIndex; i < i + dataIndicesThisChunk; i++) {
            const p = positions[i]
            chunkData.set(p, (chunkData.get(p) ?? 0) + values[i])
        }
        results.downsampledTimes.push(chunkData.size)
        chunkData.forEach((value, key) => {
            results.downsampledPositions.push(key)
            // The value for this spot will be the round-up average over the range of compressed time frames.
            results.downsampledValues.push(Math.ceil(value / thisFrameLength))
        })
        nextUnprocessedDataIndex += dataIndicesThisChunk
        nextUnprocessedTimeIndex += thisFrameLength
    }

    return results
}
*/

const computeScaleFactor = (baseScaleFactor: number, visibleRangeCount: number, maxRangeCount: number) => {
    // We want x, the smallest power of base s.t. (the visible range) * base^x > full range.
    // So if we have 2000 columns visible and can display up to 750, with base scaling of 3, we would need
    // to compress 27x (3^3) so that 27 native columns make up every display column.
    const exponent = Math.ceil(Math.log(visibleRangeCount/maxRangeCount)/Math.log(baseScaleFactor))
    return Math.max(Math.pow(baseScaleFactor, exponent), 1)
}

const staticDownsample = (values: number[], positions: number[], times: number[], scaleFactor: number): DownsampledData => {
    const results: DownsampledData = { downsampledValues: [], downsampledPositions: [], downsampledTimes: [] }
    if (scaleFactor === 1) {
        return {downsampledValues: values, downsampledPositions: positions, downsampledTimes: times}
    }
    let firstUnfinishedDataPoint = 0
    for (let i = 0; i < times.length; i += scaleFactor) {
        const chunkData: Map<number, number> = new Map()
        const pointCountThisChunk = sumRange(times, i, i + scaleFactor)
        for (let j = firstUnfinishedDataPoint; j < firstUnfinishedDataPoint + pointCountThisChunk; j++) {
            const p = positions[j]
            chunkData.set(p, (chunkData.get(p) ?? 0) + values[j])
        }
        results.downsampledTimes.push(chunkData.size)
        chunkData.forEach((value, key) => {
            results.downsampledPositions.push(key)
            results.downsampledValues.push(Math.ceil(value / scaleFactor))
        })
        firstUnfinishedDataPoint += pointCountThisChunk
    }
    return results
}

const getDownsampledRange = (scaleFactor: number, firstSelected: number, lastSelected: number) => {
    // Assume native indices start from 0
    return {
        downsampledStart: Math.floor(firstSelected / scaleFactor),
        downsampledEnd: Math.ceil(lastSelected / scaleFactor)
    }
}

const downsampleObservedPositions = (scaleFactor: number, positions: number[]): DownsampledData => {
    // TODO: Fixme to match actual data
    // For now, assume that the observed position data comes in as a 1-d series with the same indices as the main time-based series.
    if (scaleFactor < 1) {
        console.warn(`Attempt to use scale factor of less than 1 in downsampling observed position. Don't do that.`)
        return {downsampledPositions: [], downsampledTimes: [], downsampledValues: []}
    }
    // TODO: probably should check for non-integer scalefactor
    // TODO: NEED TO CONVERT POSITIONS TO INDICES! Otherwise positions parameter works as-is
    const values = Array.from({length: positions.length}, () => 255)
    const times = Array.from({length: positions.length}, () => 1)
    return staticDownsample(values, positions, times, scaleFactor)
}


type Run = {
    start: number,
    end?: number
}
type TimeColumn = Map<number, Run[]>

const argsort = (ary: number[], offset?: number): number[] => {
    const decorated = ary.map((v, i) => [v, i])
    const sorted = decorated.sort((a, b) => a[0] = b[0])
    const indices = sorted.map((i) => i[1] + (offset ?? 0))
    return indices
}

const openRun = (valueRects: Map<number, Run[]>, value: number, position: number) => {
    const run = valueRects.get(value)
    if (run === undefined) throw Error(`Attempted to open a run with value ${value} but that key did not exist. Shouldn't happen.`)
    if (run.length === 0) {
        run.push({start: position})
    } else {
        run.at(-1)?.end !== undefined && run.push({start: position})
    }
}

const closeRuns = (valueRects: Map<number, Run[]>, closingPosition: number, closeAboveThisNumber?: number) => {
    const start = closeAboveThisNumber ?? 0
    for (const [keyvalue, runs] of valueRects) {
        if (keyvalue <= start || runs.length === 0) continue
        const lastRun = (runs.at(-1) ?? {'end': 'default', 'start': 0})
        lastRun.end = lastRun.end ?? closingPosition === lastRun.start ? lastRun.start + 1 : closingPosition
    }
}

// The data are very sparse, so we can use a set-of-runs representation effectively.
// Ideally we'd be able to use these directly as vector graphics, but this winds up being very
// challenging to integrate into the (canvas-based) TimeScrollView, and we can't use a full-resolution
// Canvas (even offscreen) because it'll be represented as bitmap and blow up the memory usage.
const linesRep = (values: number[], positions: number[], times: number[]) => {
    const results: TimeColumn[] = []
    let dataIndex = 0
    times.forEach((t) => {
        const rangeValues = new Set(values.slice(dataIndex, dataIndex + t))
        const valueRuns = new Map<number, Run[]>([...rangeValues].map(v => [v, []]))
        const indices = argsort(positions.slice(dataIndex, dataIndex + t), dataIndex)
        let lastPosition = -1
        let lastValue = 0
        indices.forEach(i => {
            const p = positions[i]
            const v = values[i]
            if( p !== lastPosition + 1) {
                // close out all open runs
                // Open a new run with the current value
                closeRuns(valueRuns, p)
                openRun(valueRuns, v, p)
            } else {
                if (v !== lastValue) {
                    // start a run with value() if it isn't already going
                    openRun(valueRuns, v, p)
                    if (v < lastValue) {
                        // value went down! Close out any run with a value in (v, lastValue]
                        closeRuns(valueRuns, p, v)
                    }
                }
                // if v === lastValue, don't need to do anything: just continue our current runs
            }
            lastPosition = p
            lastValue = v
        })
        closeRuns(valueRuns, lastPosition)
        results.push(valueRuns)
        dataIndex += t
    })
    return results
}


const getVisibleFrames = (_startTimeSec: number, _samplingFrequencyHz: number, dataLength: number, visibleTimeStartSeconds?: number, visibleTimeEndSeconds?: number) => {
    const _visibleStartTime = Math.max((visibleTimeStartSeconds ?? _startTimeSec), _startTimeSec)
    const firstFrame = Math.floor((_visibleStartTime - _startTimeSec) * _samplingFrequencyHz)
    const lastFrame = visibleTimeEndSeconds === undefined
        ? dataLength - 1
        : firstFrame + Math.floor((visibleTimeEndSeconds - (visibleTimeStartSeconds ?? 0)) * _samplingFrequencyHz)
    return { firstFrame, lastFrame }
}


const DecodedLinearPositionPlotView: FunctionComponent<DecodedLinearPositionProps> = (props: DecodedLinearPositionProps) => {
    const { data, timeseriesLayoutOpts, width, height } = props
    const { values, positions, frameBounds, positionsKey, startTimeSec, samplingFrequencyHz } = data
    const _startTimeSec = startTimeSec ?? 0
    const _samplingFrequencyHz = samplingFrequencyHz ?? 1000 // TODO: better baseline (this is per-ms)
    const endTimeSec = _startTimeSec + frameBounds.length / _samplingFrequencyHz
    useRecordingSelectionTimeInitialization(_startTimeSec, endTimeSec)
    const { visibleTimeStartSeconds, visibleTimeEndSeconds } = useTimeRange()
    const [showLinearPositionsOverlay, setShowLinearPositionsOverlay] = useState<boolean>(false)
    
    const {firstFrame, lastFrame} = getVisibleFrames(_startTimeSec, _samplingFrequencyHz, frameBounds.length, visibleTimeStartSeconds, visibleTimeEndSeconds)
    const visibleFrameRange = lastFrame - firstFrame

    // TODO: Move to top or expose these as configurable
    const baseScaleFactor = 3
    const maxVisibleWidth = 20000

    const scaleFactor = computeScaleFactor(baseScaleFactor, visibleFrameRange, maxVisibleWidth)
    const { downsampledStart, downsampledEnd } = getDownsampledRange(scaleFactor, firstFrame, lastFrame)

    const sampledData = useMemo(() => staticDownsample(values, positions, frameBounds, scaleFactor), [values, positions, frameBounds, scaleFactor])
    const linesRepresentation = useMemo(() => linesRep(sampledData.downsampledValues, sampledData.downsampledPositions, sampledData.downsampledTimes), [sampledData])
    const linearPositions: number[] = []
    // TODO: also look at observed-position series from data & run it through staticDownsample
    // TODO: linesRep equivalent using the downsampled observed-position data


    const margins = useTimeseriesMargins(timeseriesLayoutOpts)
    const adjustedHeight = linearPositions ? height - 30 : height // leave an additional margin for the checkbox if we have linear positions to display
    const panelCount = 1
    const toolbarWidth = timeseriesLayoutOpts?.hideToolbar ? 0 : DefaultToolbarWidth
    const { panelWidth, panelHeight } = usePanelDimensions(width - toolbarWidth, adjustedHeight, panelCount, panelSpacing, margins)
    
    const canvas = useMemo(() => {
        return document.createElement('canvas')
    }, [])

    const renderTime = useMemo(() => {
        if (canvas === undefined) return
        canvas.width = downsampledEnd - downsampledStart
        const scaler = Math.floor(panelHeight / (positionsKey.length + 1))
        canvas.height = scaler * (positionsKey.length + 1)
        const c = canvas.getContext('2d')
        if (!c) return
        const maxVal = 255
        const minVal = 0

        const colorFn = getColorForValueFnString(minVal, maxVal)
        const emptyStyle = colorFn(0)
        // TODO: memoize the styles? Combine lines in a prepass to avoid context switches?
        c.clearRect(0, 0, canvas.width, canvas.height)
        c.fillStyle = emptyStyle
        c.fillRect(0, 0, canvas.width, canvas.height)
        const visibleSlice = linesRepresentation.slice(downsampledStart, downsampledEnd + 1)
        visibleSlice.forEach((l, i) => {
            for (const [probability, runs] of l) {
                c.strokeStyle = colorFn(probability)
                if (runs === undefined || runs.length === 0) continue
                c.beginPath()
                for (const interval of runs) {
                    if (interval.end === undefined) continue // or warn maybe; this shouldn't happen
                    c.moveTo(i, canvas.height - (scaler * interval.start))
                    c.lineTo(i, canvas.height - (scaler * interval.end))
                }
                c.stroke()
            }
        })
        // TODO: linear position overlay
        // Follows the exact same logic as used for visibleSlice but with the linearPosition data set
        // and with a visually distinct styling.

        return Date.now()
    }, [canvas, linesRepresentation, positionsKey.length, downsampledStart, downsampledEnd, panelHeight])

    const paintPanel = useCallback((context: CanvasRenderingContext2D, props: PanelProps) => {
        const canvas = props.offscreenCanvas
        if (canvas === undefined) return
        if (canvas.width === 0 || canvas.height === 0) {
            console.log(`Offscreen canvas dims ${canvas.width} x ${canvas.height}`)
            return
        }
        if (context.canvas.width === 0 || context.canvas.height === 0) {
            console.log(`Onscreen canvas dims ${context.canvas.width} x ${context.canvas.height}`)
            return
        }
        context.clearRect(0, 0, context.canvas.width, context.canvas.height)
        context.drawImage(canvas, 0, 0, panelWidth, panelHeight)
        // Could potentially use the below source-and-target-rect version of the call to reduce antialiasing, but
        // in practice it didn't seem to make much difference. (Also need to computate an integer scaling
        // factor & center the display--this was implemented but removed.)
        // context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, panelWidth, panelHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [renderTime, panelWidth, panelHeight]) // renderTime dependency forces an update when the offscreen canvas redraws

    const panels: TimeScrollViewPanel<PanelProps>[] = useMemo(() => {
        return [{
            key: `pdf`,
            label: ``,
            props: {offscreenCanvas: canvas} as PanelProps,
            paint: paintPanel
        }]
    }, [paintPanel, canvas])
    
    return (
        <div>
            <TimeScrollView
                margins={margins}
                panels={panels}
                panelSpacing={panelSpacing}
                selectedPanelKeys={emptyPanelSelection}
                timeseriesLayoutOpts={timeseriesLayoutOpts}
                width={width}
                height={adjustedHeight}
            />
            {
                linearPositions && (
                    <span>
                        <Checkbox style={{paddingTop: 0, paddingBottom: 5}} checked={showLinearPositionsOverlay} onClick={() => {setShowLinearPositionsOverlay(a => (!a))}} />
                        Show actual position overlay
                    </span>
                )
            }
        </div>
    )
}

const getColorForValueFnString = (min: number, max: number) => {
    const theScale = 255 / (max - min)
    return (v: number | undefined) => {
        if (v === undefined) return "rgba(0, 0, 0, 0)"
        if (v === 0) return "#BBBAB8" // We don't actually use 0 values in the data, this is just for the background.
        // Instead, map it to a dove-grey color that will hopefully provide decent contrast with the real color scales.
        const v_effective = Math.min(1, v/128)
        switch (COLOR_MAP_CHOICE as ValidColorMap | undefined) {
            case 'inferno':
                return inferno(v_effective)
            case 'magma':
                return magma(v_effective)
            case 'plasma':
                return plasma(v_effective)
            case 'viridis':
                return viridis(v_effective)
            default:
                const proportion = (v - min) * theScale
                const intensity = Math.max(0, Math.min(255, 3 * Math.floor(proportion)))
                return `rgba(${intensity}, ${intensity}, 60, 255)`
        }
    }
}

export default DecodedLinearPositionPlotView