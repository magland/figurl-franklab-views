import { DefaultToolbarWidth, TimeScrollView, TimeScrollViewPanel, usePanelDimensions, useRecordingSelectionTimeInitialization, useTimeRange, useTimeseriesMargins } from '@figurl/timeseries-views'
import { Checkbox } from '@material-ui/core'
import { FunctionComponent, useCallback, useMemo, useState } from 'react'
import { ValidColorMap } from '../view-track-position-animation/TPADecodedPositionLayer'
import { computeScaleFactor, downsampleObservedPositions, getDownsampledRange, getVisibleFrames, staticDownsample } from './DecodedLinearPositionDownsampling'
import { getColorStyles, OffscreenRenderProps, useOffscreenCanvasRange, useOffscreenPainter, usePositions } from './DecodedLinearPositionDrawing'
import { DecodedLinearPositionPlotData } from './DecodedLinearPositionPlotViewData'
// import { TimeseriesLayoutOpts } from '@figurl/timeseries-views'

// TODO: Make these configurable
const BASE_SCALE_FACTOR = 3
const MAX_WIDTH_FOR_SCALING = 2000
const MAX_OFFSCREEN_CANVAS_WIDTH = 2000
const MAX_OFFSCREEN_CANVAS_HEIGHT = 1000
const DEFAULT_SAMPLES_PER_SECOND = 1000

const DEFAULT_COLOR_MAP_CHOICE: ValidColorMap | undefined = 'viridis'

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
    displayRange: [number, number]
    showObservedPositionsOverlay: boolean
    scaledObservedPositions: number[] | undefined
    observedPositionsStyle: string | undefined
    downsampledStart: number
    downsampledEnd: number
}

const panelSpacing = 4
const emptyPanelSelection = new Set<number | string>()


const DecodedLinearPositionPlotView: FunctionComponent<DecodedLinearPositionProps> = (props: DecodedLinearPositionProps) => {
    const { data, timeseriesLayoutOpts, width, height } = props
    const { values, positions, frameBounds, positionsKey, startTimeSec, samplingFrequencyHz, observedPositions } = data
    const _startTimeSec = startTimeSec ?? 0
    const _samplingFrequencyHz = samplingFrequencyHz ?? DEFAULT_SAMPLES_PER_SECOND
    const endTimeSec = _startTimeSec + frameBounds.length / _samplingFrequencyHz
    useRecordingSelectionTimeInitialization(_startTimeSec, endTimeSec)
    const { visibleTimeStartSeconds, visibleTimeEndSeconds } = useTimeRange()
    const [showObservedPositionsOverlay, setShowObservedPositionsOverlay] = useState<boolean>(false)
    const { colorStyles, contrastStyle } = useMemo(() => getColorStyles(DEFAULT_COLOR_MAP_CHOICE), [])

    const {firstFrame, lastFrame} = getVisibleFrames(_startTimeSec, _samplingFrequencyHz, frameBounds.length, visibleTimeStartSeconds, visibleTimeEndSeconds)
    const visibleFrameRange = lastFrame - firstFrame
    
    const scaleFactor = computeScaleFactor(BASE_SCALE_FACTOR, visibleFrameRange, MAX_WIDTH_FOR_SCALING)
    console.log(`Scale factor: ${scaleFactor}`)
    let now = Date.now()
    const { downsampledStart, downsampledEnd } = getDownsampledRange(scaleFactor, firstFrame, lastFrame)

    // Possibility: would it be reasonable to cache every downsampling level we touch? Could become memory-prohibitive...
    // Note that computing the representation winds up being more expensive than the downsampling. Maybe we can cache and/or skip that step?
    // Note: have not experimented with drawing direct from the downsampled version; this would probably involve manually creating the full bitmap.
    // now = Date.now()
    // console.log(`\tDownsampling data: ${now}`)
    const sampledData = useMemo(() => staticDownsample(values, positions, frameBounds, scaleFactor), [values, positions, frameBounds, scaleFactor])
    // console.log(`\t\t...Finished downsampling data: ${Date.now() - now}`)
    // now = Date.now()
    // console.log(`\tGetting rectangles representation for downsampled data: ${now}`)

    // const linesRepresentation = useMemo(() => convertToOverlappingRectangles(sampledData.downsampledValues, sampledData.downsampledPositions, sampledData.downsampledTimes), [sampledData])

    // console.log(`\t\t...Finished representing data: ${Date.now() - now}`)
    // now = Date.now()
    // console.log(`\tDownsampling observed position: ${now}`)
    const downsampledObserved = useMemo(() => observedPositions ? downsampleObservedPositions(scaleFactor, observedPositions) : undefined, [observedPositions, scaleFactor])
    const lastPosition = useMemo(() => (positionsKey.at(-1) ?? 0) + positionsKey[0], [positionsKey])
    const scaledObserved = useMemo(() => downsampledObserved === undefined ? undefined : downsampledObserved.map(p => 1 - (p/lastPosition)), [lastPosition, downsampledObserved])
    // console.log(`\t\t...Finished downsampling observed: ${Date.now() - now}`)
    // The below could be used to use an SVG version of the observed position path rather than the downsampled one.
    // const observedPath = useMemo(() => {
    //     if (observedPositions === undefined || observedPositions.length === 0) return undefined
    //     let lastP = -lastPosition
    //     const epsilon = lastPosition * .005 // if difference is over half a percent, don't draw a connecting line
    //     const pathString: string[] = [`M 0 ${lastP}`]
    //     for(let i = 1; i < observedPositions.length; i++) {
    //         const delta = observedPositions[i] - observedPositions[i - 1]
    //         pathString.push(Math.abs(delta) > epsilon ? `m1 ${delta}` : `l1 ${delta}`)
    //     }
    //     const path = new Path2D(pathString.join(' '))
    //     return path
    // }, [observedPositions])

    const margins = useTimeseriesMargins(timeseriesLayoutOpts)
    const adjustedHeight = observedPositions ? height - 30 : height // leave an additional margin for the checkbox if we have linear positions to display
    const panelCount = 1
    const toolbarWidth = timeseriesLayoutOpts?.hideToolbar ? 0 : DefaultToolbarWidth
    const { panelWidth, panelHeight } = usePanelDimensions(width - toolbarWidth, adjustedHeight, panelCount, panelSpacing, margins)
    
    const canvas = useMemo(() => {
        const canvas = document.createElement('canvas')
        return canvas
    }, [])

    const { canvasPositions, targetHeight } = usePositions(MAX_OFFSCREEN_CANVAS_HEIGHT, positionsKey)
    const canvasTargetWidth = useMemo(() => Math.min(MAX_OFFSCREEN_CANVAS_WIDTH, sampledData.downsampledTimes.length), [sampledData.downsampledTimes.length])
    const painter = useOffscreenPainter(colorStyles, targetHeight, canvasPositions)
    const offscreenRenderProps = useMemo(() => {
        const props: OffscreenRenderProps = {
            canvas,
            canvasTargetWidth,
            canvasTargetHeight: targetHeight,
            painter,
            scale: scaleFactor,
            sampledData,
            downsampledRangeStart: downsampledStart,
            downsampledRangeEnd: downsampledEnd
        }
        return props
    }, [canvas, targetHeight, scaleFactor, sampledData, downsampledStart, downsampledEnd, canvasTargetWidth, painter])
    now = Date.now()
    console.log(`\tRendering to offscreen canvas: ${now}`)
    const displayRange = useOffscreenCanvasRange(offscreenRenderProps)
    console.log(`\t\t...done rendering to offscreen canvas: ${Date.now() - now}`)

    const paintPanel = useCallback((context: CanvasRenderingContext2D, props: PanelProps) => {
        if (canvas === undefined) return
        const {displayRange, showObservedPositionsOverlay, scaledObservedPositions, observedPositionsStyle, downsampledStart, downsampledEnd} = props
        // let now = Date.now()
        // console.log(`\tDoing render: ${now}`)
        context.clearRect(0, 0, context.canvas.width, context.canvas.height)
        context.imageSmoothingEnabled = false
        context.drawImage(canvas, displayRange[0], 0, displayRange[1] - displayRange[0], canvas.height, 0, 0, panelWidth, panelHeight)
        // Experimenting with using paths to represent the observed position. Bears more investigating, as the path could be cached
        // much more easily than downsampling, but getting it right with the rest of the drawing apparatus is bothersome.
    //     if (showObservedPositionsOverlay && observedPositions !== undefined && observedPath !== undefined) {
    //         context.strokeStyle = (observedPositionsStyle ?? '#000000')
    //         context.lineWidth = 2
    //         let m = new DOMMatrix()
    //         m.a = panelWidth / (lastFrame - firstFrame)
    //         m.b = 0
    //         m.c = 0
    //         m.d = -1 * panelHeight / lastPosition
    //         m.e = -(firstFrame * panelWidth / observedPositions.length)
    //         m.f = -panelHeight/2 // this isn't quite right
    //         let scaledPath = new Path2D()
    //         scaledPath.addPath(observedPath, m)
    //         context.stroke(scaledPath)
    //     }
    // }, [canvas, panelWidth, panelHeight, observedPath, firstFrame, lastFrame, observedPositions?.length])
        if (showObservedPositionsOverlay && scaledObservedPositions !== undefined) {
            const visibleObserved = scaledObservedPositions.slice(downsampledStart, downsampledEnd + 1)
            const xStepSize = visibleObserved.length > 0 ? panelWidth / (visibleObserved.length) : 1
            let lastP = visibleObserved[0]
            context.strokeStyle = (observedPositionsStyle ?? '#000000')
            context.lineWidth = 2
            context.beginPath()
            visibleObserved.forEach((v, i) => {
                Math.abs(v - lastP) > .005 ? context.moveTo(i * xStepSize, panelHeight * v) : context.lineTo(i * xStepSize, panelHeight * v)
                lastP = v
            })
            context.stroke()
        }
        // console.log(`\t\tDone with render: ${Date.now() - now}`)
    }, [canvas, panelWidth, panelHeight])


    const panels: TimeScrollViewPanel<PanelProps>[] = useMemo(() => {
        return [{
            key: `pdf`,
            label: ``,
            props: {
                displayRange,
                showObservedPositionsOverlay,
                scaledObservedPositions: scaledObserved,
                observedPositionsStyle: contrastStyle,
                downsampledStart,
                downsampledEnd } as PanelProps,
            paint: paintPanel
        }]
    }, [paintPanel, displayRange, downsampledStart, downsampledEnd, showObservedPositionsOverlay, scaledObserved, contrastStyle])
    // console.log(`----------`)
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
                observedPositions && (
                    <span>
                        <Checkbox style={{paddingTop: 0, paddingBottom: 5}} checked={showObservedPositionsOverlay} onClick={() => {setShowObservedPositionsOverlay(a => (!a))}} />
                        Show actual position overlay
                    </span>
                )
            }
        </div>
    )
}

export default DecodedLinearPositionPlotView