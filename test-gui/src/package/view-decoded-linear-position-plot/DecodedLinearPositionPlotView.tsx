import { DefaultToolbarWidth, TimeScrollView, TimeScrollViewPanel, usePanelDimensions, useRecordingSelectionTimeInitialization, useTimeRange, useTimeseriesMargins } from '@figurl/timeseries-views'
import { Checkbox } from '@material-ui/core'
import { FunctionComponent, useCallback, useMemo, useState } from 'react'
import { ValidColorMap } from '../view-track-position-animation/TPADecodedPositionLayer'
import { computeScaleFactor, getDownsampledRange, getVisibleFrames, staticDownsample } from './DecodedLinearPositionDownsampling'
import { getColorStyles, OffscreenRenderProps, useOffscreenCanvasRange, useOffscreenPainter, usePositions } from './DecodedLinearPositionDrawing'
import { DecodedLinearPositionPlotData } from './DecodedLinearPositionPlotViewData'
// import { TimeseriesLayoutOpts } from '@figurl/timeseries-views'

// TODO: Make these configurable?
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
    const { downsampledStart, downsampledEnd } = getDownsampledRange(scaleFactor, firstFrame, lastFrame)

    // Possibility: would it be reasonable to cache every downsampling level we touch? Could become memory-prohibitive...
    const sampledData = useMemo(() => staticDownsample(values, positions, frameBounds, scaleFactor), [values, positions, frameBounds, scaleFactor])
    const lastPosition = useMemo(() => (positionsKey.at(-1) ?? 0) + positionsKey[0], [positionsKey])
    const scaledObserved = useMemo(() => observedPositions === undefined ? undefined : observedPositions.map(p => 1 - (p/lastPosition)), [lastPosition, observedPositions])

    const margins = useTimeseriesMargins(timeseriesLayoutOpts)
    const adjustedHeight = observedPositions ? height - 30 : height // leave an additional margin for the checkbox if we have linear positions to display
    const panelCount = 1
    const toolbarWidth = timeseriesLayoutOpts?.hideToolbar ? 0 : DefaultToolbarWidth
    const { panelWidth, panelHeight } = usePanelDimensions(width - toolbarWidth, adjustedHeight, panelCount, panelSpacing, margins)
    
    const canvas = useMemo(() => {
        const canvas = document.createElement('canvas')
        return canvas
    }, [])

    const { canvasPositions, pixelBinWidth, targetHeight } = usePositions(MAX_OFFSCREEN_CANVAS_HEIGHT, positionsKey)
    const canvasTargetWidth = useMemo(() => Math.min(MAX_OFFSCREEN_CANVAS_WIDTH, sampledData.downsampledTimes.length), [sampledData.downsampledTimes.length])
    const painter = useOffscreenPainter(colorStyles, targetHeight, pixelBinWidth, canvasPositions)
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
    const displayRange = useOffscreenCanvasRange(offscreenRenderProps)

    const paintPanel = useCallback((context: CanvasRenderingContext2D, props: PanelProps) => {
        if (canvas === undefined) return
        const {displayRange, showObservedPositionsOverlay, scaledObservedPositions, observedPositionsStyle, downsampledStart, downsampledEnd} = props
        context.clearRect(0, 0, context.canvas.width, context.canvas.height)
        context.imageSmoothingEnabled = false
        context.drawImage(canvas, displayRange[0], 0, displayRange[1] - displayRange[0], canvas.height, 0, 0, panelWidth, panelHeight)
        if (showObservedPositionsOverlay && scaledObservedPositions !== undefined) {
            const verticalEpsilonPx = 4
            const alignedStart = downsampledStart * scaleFactor
            const alignedEnd = downsampledEnd * scaleFactor
            const visibleObserved = scaledObservedPositions.slice(alignedStart, alignedEnd + 1)
            const xStepSize = visibleObserved.length > 0 ? panelWidth / (visibleObserved.length) : 1
            context.strokeStyle = (observedPositionsStyle ?? '#000000')
            context.lineWidth = 2
            let lastY = -5
            let lastX = -5   // avoids performance loss from drawing sub-pixel points on top of each other. Negative value to handle first point right
            context.beginPath()
            visibleObserved.forEach((v, i) => {
                const x = i * xStepSize
                const y = (panelHeight * v) + 2
                const deltaY = Math.abs(Math.floor(y) - Math.floor(lastY))
                if ((Math.floor(lastX) !== Math.floor(x)) || (Math.floor(y) !== Math.floor(lastY))) {
                    deltaY > (verticalEpsilonPx) ? context.moveTo(x, y) : context.lineTo(x, y)
                }
                lastX = x
                lastY = y
            })
            context.stroke()
        }
    }, [canvas, panelWidth, panelHeight, scaleFactor])


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