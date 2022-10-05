import { DefaultToolbarWidth, TimeScrollView, TimeScrollViewPanel, usePanelDimensions, useRecordingSelectionTimeInitialization, useTimeRange, useTimeseriesMargins } from '@figurl/timeseries-views'
import { Checkbox } from '@material-ui/core'
import { FunctionComponent, useCallback, useMemo, useState } from 'react'
import { DecodedLinearPositionPlotData } from './DecodedLinearPositionPlotViewData'
// import { TimeseriesLayoutOpts } from '@figurl/timeseries-views'

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
    let end = min([endExclusive, array.length]) || 0
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
// If nothing else, I'm sure we could accomplish this with a linear transform, BUT AGAIN the entire premise
// is that the dense-matrix representation won't fit comfortably in memory.
// I suppose we could do like, chunks over it?
// TODO: Probably that
// Anyway this is summing over the samples, but we could also average, or do something actually sophisticated
const downsample = (values: number[], positions: number[], times: number[], framesPerPixel: number): DownsampledData => {
    let nextIncompleteTimeIndex = 0
    let runningTimeIndexTotal = 0
    let nextIncompleteDataIndex = 0
    const results: DownsampledData = { downsampledValues: [], downsampledPositions: [], downsampledTimes: [] }
    while (runningTimeIndexTotal < times.length) {
        runningTimeIndexTotal += framesPerPixel
        const thisFrameLength = Math.floor(runningTimeIndexTotal - nextIncompleteTimeIndex)
        const dataIndicesThisChunk = sumRange(times, nextIncompleteTimeIndex, nextIncompleteTimeIndex + thisFrameLength + 1)
        const chunkData: Map<number, number> = new Map()
        for (let i = nextIncompleteDataIndex; i < i + dataIndicesThisChunk; i++) {
            const p = positions[i]
            chunkData.set(p, (chunkData.get(p) ?? 0) + values[i])
        }
        results.downsampledTimes.push(chunkData.size)
        chunkData.forEach((value, key) => {
            results.downsampledPositions.push(key)
            results.downsampledValues.push(value)
        })
        nextIncompleteDataIndex += dataIndicesThisChunk
        nextIncompleteTimeIndex += thisFrameLength
    }

    return results
}


type Run = {
    start: number,
    end?: number
}
type TimeColumn = {
    valueRects: Map<number, Run[]>,
    min?: number,
    max?: number
}

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
        const lastRun = (runs.at(-1) ?? {'end': 'default'})
        lastRun.end = lastRun.end ?? closingPosition
    }
}

// Alternative approach: instead of downsampling. Keep the sparse representation by converting into scan-lined-based per-color lines.
const linesRep = (values: number[], positions: number[], times: number[]) => {
    const results: TimeColumn[] = []
    let dataIndex = 0
    times.forEach((t) => {
        const rangeValues = new Set(values.slice(dataIndex, dataIndex + t))
        const maxValue = Math.max(...rangeValues)
        const minValue = Math.min(...rangeValues)
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
        results.push({valueRects: valueRuns, min: minValue, max: maxValue})
        dataIndex += t
    })
    return results
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
    
    // ****** Row-range representation
    const perFrameLinesRepresentation = useMemo(() => linesRep(values, positions, frameBounds), [values, positions, frameBounds])
    const visibleLines = useMemo(() => {
        const firstFrame = ((visibleTimeStartSeconds ?? 0) - _startTimeSec)
        const lastFrame = 1 + ((visibleTimeEndSeconds === undefined)
            ? perFrameLinesRepresentation.length
            : firstFrame + Math.floor((visibleTimeEndSeconds - (visibleTimeStartSeconds ?? 0)) * _samplingFrequencyHz))
        return perFrameLinesRepresentation.slice(firstFrame, lastFrame)
    }, [perFrameLinesRepresentation, visibleTimeStartSeconds, visibleTimeEndSeconds, _startTimeSec, _samplingFrequencyHz])


    // ****** THE DOWNSAMPLING VERSION
    // // So we would like to assemble a couple things.
    // // We need a complete matrix to correspond to the data in range.
    // // The other thing we need is the linear overlay.
    // // That comes from the data that came in somehow--need to sort that out at source.

    // // Step 0: Restrict visible range
    // // TODO: Replace the sampling freq business with a computation based on len(frameBounds) and
    // // the startTimeSec, endTimeSec delta
    // const { startDataIndex, endDataIndex, startTimeIndex, endTimeIndex } = useMemo(() => {
    //     const startTimeIndex = Math.floor(((visibleTimeStartSeconds ?? 0) - _startTimeSec) * _samplingFrequencyHz)
    //     const endTimeIndexOffset = Math.floor((endTimeSec - (visibleTimeEndSeconds ?? 0)) * _samplingFrequencyHz)
    //     const endTimeIndex = frameBounds.length - (endTimeIndexOffset)
    //     const startDataIndex = sumRange(frameBounds, 0, startTimeIndex)
    //     // TODO: double-check for off-by-one here
    //     const endDataIndex = startDataIndex + sumRange(frameBounds, startTimeIndex, endTimeIndex) + 1
    //     return { startDataIndex, endDataIndex, startTimeIndex, endTimeIndex }
    // }, [visibleTimeStartSeconds, visibleTimeEndSeconds, frameBounds])

    // // restrict data ranges to ranges we care about
    // const { visibleFrames, visibleValues, visiblePositions } = useMemo(() => {
    //     return {
    //         visibleFrames: frameBounds.slice(startTimeIndex, endTimeIndex),
    //         visibleValues: values.slice(startDataIndex, endDataIndex),
    //         visiblePositions: positions.slice(startDataIndex, endDataIndex)
    //     }
    // }, [startTimeIndex, endTimeIndex, startDataIndex, endDataIndex, frameBounds, values, positions])

    // // TODO: Better fix on the positions key issue, make sure we don't skip anything!

    // // TODO: downsampling with the all-in-memory data
    // // because I think we do still need to do it...
    // // basically, each *pixel* at each 
    
    // // TODO: Would it be better to make a grid of the whole thing? It's just a bunch of ints...
    // // hahahaha no that's going to be huge
    // // Okay, we *have* to downsample, we can't store the whole blown-out thing at full resolution
    
    // // There's probably a closed-form version of this, but we'll probably use more sophisticated
    // // downsampling anyway.
    // const samplesPerPixel = useMemo(() => {
    //     return visibleFrames.length / width
    // }, [visibleFrames, width])
    
    // const { downsampledValues, downsampledPositions, downsampledTimes } = useMemo(() => {
    //     return downsample(visibleValues, visiblePositions, visibleFrames, samplesPerPixel)
    // }, [visibleValues, visiblePositions, visibleFrames, samplesPerPixel])
    
    // // TODO: This needs to restrict over the visible range
    // const { maxValue, minValue } = useMemo(() => {
    //     const maxValue = max(downsampledValues) ?? 255
    //     const minValue = min(downsampledValues) ?? 0
    //     return { maxValue, minValue }
    // }, [downsampledValues])
    // const numTimepoints = useMemo(() => downsampledTimes.length, [downsampledTimes])

    // const imageData = useMemo(() => {
    //     // need to type-check anything?
    //     const colorForValue = getColorForValueFn(minValue, maxValue)
    //     const invertedPosition = (p: number) => positionsKey.length - p
    //     const zeroValue = colorForValue(0)
    //     const totalTimePoints = downsampledTimes.length
    //     const totalLinearPositionBuckets = positionsKey.length
    //     const data = Array.from({length: totalTimePoints}, () => new Array(totalLinearPositionBuckets).fill(zeroValue))
        
    //     // Remember to invert the y-axis.
    //     let dataSoFar = 0
    //     data.forEach((valuesThisTimePoint, timePoint) => {
    //         const dataPointsThisTimePoint = downsampledTimes[timePoint]
    //         for (let i = dataSoFar; i < dataPointsThisTimePoint; i++) {
    //             const position = invertedPosition(downsampledPositions[i])
    //             valuesThisTimePoint[position] = colorForValue(downsampledValues[i])
    //         }
    //         dataSoFar += dataPointsThisTimePoint
    //     })
    //     const clampedData = Uint8ClampedArray.from(data.flat())
    //     const imageData = new ImageData(clampedData, totalTimePoints)
    //     return imageData
    // }, [visibleFrames, positionsKey])

    const linearPositions: number[] = []
    // ******* Pre-existing linear position and range sample stuff
    // const rangeStartSample = useMemo(() => {
    //     return visibleTimeStartSeconds === undefined ? 0 : Math.max(0, Math.floor(visibleTimeStartSeconds - startTimeSec) * samplingFrequency)
    // }, [visibleTimeStartSeconds, startTimeSec, samplingFrequency])
    // const rangeEndSample = useMemo(() => {
    //     return visibleTimeEndSeconds === undefined ? 0 : Math.min(numTimepoints, Math.ceil((visibleTimeEndSeconds - startTimeSec) * samplingFrequency))
    // }, [visibleTimeEndSeconds, numTimepoints, startTimeSec, samplingFrequency])

    // const downsampleFactor = useMemo(() => {
    //     if (visibleTimeStartSeconds === undefined || visibleTimeEndSeconds === undefined) return 1
    //     const target = (rangeEndSample - rangeStartSample)/width
    //     const factor = Math.ceil(Math.log(target)/Math.log(multiscaleFactor))
    //     return Math.pow(multiscaleFactor, factor)
    // }, [visibleTimeStartSeconds, visibleTimeEndSeconds, rangeEndSample, rangeStartSample, width, multiscaleFactor])
    
    // const visibleLinearPositions: number[] | undefined = useMemo(() => {
    //     if (!linearPositions) return undefined
    //     if (visibleTimeStartSeconds === undefined) return undefined
    //     if (visibleTimeEndSeconds === undefined) return undefined
    //     const i1 = Math.max(0, Math.floor((visibleTimeStartSeconds - _startTimeSec) * _samplingFrequencyHz))
    //     const i2 = Math.min(numTimepoints, Math.ceil((visibleTimeEndSeconds - _startTimeSec) * _samplingFrequencyHz))
    //     return linearPositions.slice(i1, i2)
    // }, [numTimepoints, linearPositions, _samplingFrequencyHz, startTimeSec, visibleTimeStartSeconds, visibleTimeEndSeconds])
    
    const margins = useTimeseriesMargins(timeseriesLayoutOpts)
    const adjustedHeight = linearPositions ? height - 30 : height // leave an additional margin for the checkbox if we have linear positions to display
    const panelCount = 1
    const toolbarWidth = timeseriesLayoutOpts?.hideToolbar ? 0 : DefaultToolbarWidth
    const { panelWidth, panelHeight } = usePanelDimensions(width - toolbarWidth, adjustedHeight, panelCount, panelSpacing, margins)
    
    const canvas = useMemo(() => {
        return document.createElement('canvas')
    }, [])

    const renderTime = useMemo(() => {
    // ****** Row-Range version, draw up a fixed offscreen canvas
        // TODO: scaling per actual positions map
        if (canvas === undefined) return
        canvas.width = visibleLines.length
        canvas.height = positionsKey.length + 1
        const c = canvas.getContext('2d')
        if (!c) return
        // // This blows up the stack :(
        // const maxVal = Math.max(...(visibleLines.map(l => l.max ?? 0)))
        // const minVal = Math.min(...(visibleLines.map(l => l.min ?? 255)))
        let maxVal = 0
        let minVal = 255
        visibleLines.forEach(l => {
            if (l.max !== undefined) {
                maxVal = maxVal < l.max ? l.max : maxVal
            }
            if (l.min !== undefined) {
                minVal = minVal > l.min ? l.min : minVal
            }
        })

        const colorFn = getColorForValueFnString(minVal, maxVal)
        const emptyStyle = colorFn(0)
        // TODO: memoize the styles or sth? Combine lines in a prepass to avoid context switches?
        c.clearRect(0, 0, canvas.width, canvas.height)
        c.fillStyle = emptyStyle
        c.fillRect(0, 0, canvas.width, canvas.height)
        visibleLines.forEach((l, i) => {
            if (i < 10) console.log(`Printing run ${i} which is ${JSON.stringify(l)} with ${l.valueRects.size} entries`)
            for (const [probability, runs] of l.valueRects) {
                c.strokeStyle = colorFn(probability)
                if (runs === undefined || runs.length === 0) continue
                c.beginPath()
                for (const interval of runs) {
                    if (interval.end === undefined) continue // or warn or something, this shouldn't happen
                    c.moveTo(i, canvas.height - interval.start)
                    c.lineTo(i, canvas.height - interval.end)
                }
                c.stroke()
            }
        })
        // TODO: linear position overlay

        return Date.now()
    }, [canvas, visibleLines, positionsKey.length])

    // ****** Row-range paint-panel: only rescales the fixed offscreen canvas and displays that.

    // TODO: Fix a) not rendering on first load
    // TODO: Fix b) debounce on panel size changes, don't sweat drawing the intermediary frames
    const paintPanel = useCallback((context: CanvasRenderingContext2D, props: PanelProps) => {
        const canvas = props.offscreenCanvas
        if (canvas === undefined) return
        context.clearRect(0, 0, context.canvas.width, context.canvas.height)
        context.drawImage(canvas, 0, 0, panelWidth, panelHeight)
        // context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, panelWidth, panelHeight)
    }, [renderTime, panelWidth, panelHeight])

    // ****** LEGACY PAINT PANEL -- WILL WANT TO COPY FOR THE IMAGE VERSION
    // const paintPanel = useCallback((context: CanvasRenderingContext2D, props: PanelProps) => {
    //     const canvas = props.offscreenCanvas
    //     if (canvas === undefined) return
    //     if (!imageData) return
    //     canvas.width = imageData.width
    //     canvas.height = imageData.height
    //     const c = canvas.getContext('2d')
    //     if (!c) return
        
    //     c.clearRect(0, 0, canvas.width, canvas.height)
    //     c.putImageData(imageData, 0, 0)
    //     if ((showLinearPositionsOverlay) && (visibleLinearPositions)) {
    //         c.fillStyle = 'white'
    //         c.strokeStyle = 'white'
    //         for (let i = 0; i < visibleLinearPositions.length; i++) {
    //             const xx = i / downsampleFactor
    //             const yy = imageData.height - 1 - visibleLinearPositions[i]
    //             c.fillRect(xx - 0.5, yy + 0.5, 1, 1)
    //         }
    //     }
    //     // Draw scaled version of image
    //     // See: https://stackoverflow.com/questions/3448347/how-to-scale-an-imagedata-in-html-canvas

    //     // Scaling the offscreen canvas can be done when it's drawn in, which avoids having to deal with transforms and some margin issues.
    //     context.clearRect(0, 0, context.canvas.width, context.canvas.height)
    //     context.drawImage(canvas, 0, 0, panelWidth, panelHeight)
    // }, [imageData, showLinearPositionsOverlay, visibleLinearPositions, downsampleFactor, panelWidth, panelHeight])

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

export const allocate2d = (N1: number, N2: number, value: number | undefined) => {
    const ret: (number | undefined)[][] = []
    for (let i1 = 0; i1 < N1; i1++) {
        ret.push(allocate1d(N2, value))
    }
    return ret
}

export const allocate1d = (N: number, value: number | undefined) => {
    const ret: (number | undefined)[] = []
    for (let i = 0; i < N; i++) ret.push(value)
    return ret
}

/**
 * Given a range of values, generates a function that maps a (possibly undefined)
 * value in that range into an RGBA color value whose R and G intensities are
 * in (0, 255) and proportional to the value's position within the range.
 * The generated function returns black transparent pixels for undefined values.
 * @param min Lowest value in the data range.
 * @param max Highest value in the data range.
 * @returns Convenience function to convert values to proportionally colored pixels.
 */
const getColorForValueFn = (min: number, max: number) => {
    const theScale = 255 / (max - min)
    return (v: number | undefined) => {
        if (v === undefined) return [0, 0, 0, 0]
        const proportion = (v - min) * theScale
        const intensity = Math.max(0, Math.min(255, 3 * Math.floor(proportion)))
        return [intensity, intensity, 60, 255]
    }
}

const getColorForValueFnString = (min: number, max: number) => {
    const theScale = 255 / (max - min)
    return (v: number | undefined) => {
        if (v === undefined) return "rgba(0, 0, 0, 0)"
        const proportion = (v - min) * theScale
        const intensity = Math.max(0, Math.min(255, 3 * Math.floor(proportion)))
        return `rgba(${intensity}, ${intensity}, 60, 255)`
    }
}

const min = (a: (number | undefined)[]) => {
    return a.filter(x => (x !== undefined)).reduce((prev, current) => ((prev as number) < (current as number)) ? prev : current, a[0] || 0)
}

const max = (a: (number | undefined)[]) => {
    return a.filter(x => (x !== undefined)).reduce((prev, current) => ((prev as number) > (current as number)) ? prev : current, a[0] || 0)
}

export default DecodedLinearPositionPlotView