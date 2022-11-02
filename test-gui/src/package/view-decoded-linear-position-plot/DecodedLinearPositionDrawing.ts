import { useCallback, useMemo, useRef } from 'react'
import { inferno, magma, plasma, viridis } from 'scale-color-perceptual'
import { ValidColorMap } from '../view-track-position-animation/TPADecodedPositionLayer'
import { TimeColumn } from './DecodedLinearPositionLineRepresentations'

// const DARK_DOVE_GREY = 'rgb(119, 118, 114)'

export const usePositions = (maxOffscreenCanvasHeight: number, positionsKey: number[]) => {
    return useMemo(() => {
        const basePosition = positionsKey[0] // bin coordinates are actually the top of the range
        const lastPosition = (positionsKey.at(-1) ?? basePosition) + basePosition
        const vscale = Math.floor(maxOffscreenCanvasHeight/lastPosition)
        const canvasPositions = [0, ...positionsKey, lastPosition].map(n => vscale * n)
        const targetHeight = Math.ceil(vscale * lastPosition)
        return { canvasPositions, targetHeight }
    }, [positionsKey, maxOffscreenCanvasHeight])
}


export type OffscreenRenderProps = {
    canvas: HTMLCanvasElement | undefined
    canvasTargetWidth: number
    canvasTargetHeight: number
    painter: OffscreenPainter
    linesRepresentation: TimeColumn[]
    scale: number
    downsampledRangeStart: number
    downsampledRangeEnd: number
}
// Given a Canvas with stuff drawn on it and a data set, and a desired range of data from the data set,
// return the x-coordinate pixel range in the offscreen canvas that contains the requested data range.
export const useOffscreenCanvasRange = (props: OffscreenRenderProps): [number, number] => {
    const contentsStart = useRef<number>(0)
    const contentsEnd = useRef<number>(0)
    const currentScale = useRef<number>(0)
    const { canvas, canvasTargetWidth, canvasTargetHeight, painter, scale, linesRepresentation, downsampledRangeStart, downsampledRangeEnd } = props

    if (canvas === undefined) return [0, 0]

    // Checking this on a useEffect hook was not responsive enough--it wasn't updating until the *second* rerender.
    if (scale !== currentScale.current) {
        currentScale.current = scale
        contentsStart.current = 0
        contentsEnd.current = 0
    }

    // NOTE: React wants to resize this canvas on every soft reload. I don't expect it to be a problem generally, but
    // when it does happen we need to invalidate the cache since the canvas contents get cleared by the resize.
    if ((canvas.width !== canvasTargetWidth || canvas.height !== canvasTargetHeight)) {
        canvas.width = canvasTargetWidth
        canvas.height = canvasTargetHeight
        contentsStart.current = 0
        contentsEnd.current = 0
    }

    console.assert(contentsStart.current <= contentsEnd.current)
    if ((downsampledRangeEnd - downsampledRangeStart) > (canvas.width)) {
        throw Error(`Impossible situation: requested window ${downsampledRangeStart}-${downsampledRangeEnd} does not fit in canvas width ${canvas.width} as allowed by current scale factor ${scale}`)
    }

    // Request can be served from cache--do so
    if (contentsStart.current <= downsampledRangeStart && downsampledRangeEnd <= contentsEnd.current) {
        const pixelStart = (downsampledRangeStart - contentsStart.current)
        const pixelEnd = (downsampledRangeEnd - contentsStart.current)
        return [pixelStart, pixelEnd]
    }

    // Request cannot be served from cache.
    const visibleRangeMidpoint = Math.floor((downsampledRangeEnd - downsampledRangeStart)/2) + downsampledRangeStart
    const {targetStart, targetEnd} = getRenderTargetRange(visibleRangeMidpoint, linesRepresentation.length - 1, canvas.width)

    // TODO: Can this be passed off to a separate worker thread?
    // TODO: Further refactoring could separate this entirely, since the rest of this function does not care about a)
    // whether the canvas actually exists and b) the painter, canvas, or lines-representation. Mostly.
    updateCachedImage(targetStart, targetEnd, contentsStart.current, contentsEnd.current, painter, linesRepresentation, canvas)

    contentsStart.current = targetStart
    contentsEnd.current = targetEnd

    return [downsampledRangeStart - contentsStart.current, downsampledRangeEnd - contentsStart.current]
}


const updateCachedImage = (targetStart: number, targetEnd: number, currentStart: number, currentEnd: number, painter: OffscreenPainter, linesRepresentation: TimeColumn[], canvas: HTMLCanvasElement) => {
    const c = canvas.getContext('2d')
    if (!c) {
        console.warn(`Problem getting drawing context for offscreen canvas.`)
        return
    }

    if (targetStart >= currentEnd || targetEnd <= currentStart) {
        // console.log(`replacing full cache`)
        painter(targetStart, targetEnd - targetStart, 0, linesRepresentation, c)
    } else {
        const uncopyableLeftWidth = Math.max(0, currentStart - targetStart)
        const copyRange = [Math.max(targetStart, currentStart), Math.min(targetEnd, currentEnd)]
        if (copyRange[0] === copyRange[1]) {
            console.warn(`Should not reach this branch: if there's nothing to copy we should've replaced the full cache.`)
        }
        const copyWidth = 1 + copyRange[1] - copyRange[0]
        const uncopyableRightWidth = Math.max(0, targetEnd - currentEnd)
        // console.log(`Partial replacement. Left: ${uncopyableLeftWidth} copy: (${copyRange[0]} - ${copyRange[1]}) = ${copyWidth} balance: ${uncopyableRightWidth}\nTotal: ${uncopyableLeftWidth + uncopyableRightWidth + copyWidth}`)
        // The copy has to happen first, or we'll start overwriting the data we want to keep.
        if (copyRange[0] < copyRange[1]) {
            const copyStart = copyRange[0] - currentStart
            const copyTarget = uncopyableLeftWidth
            // console.log(`Copying ${copyStart} (${copyRange[0]} - ${contentsStart.current}) into ${copyTarget}`)
            c.drawImage(canvas, copyStart, 0, copyWidth, canvas.height, copyTarget, 0, copyWidth, canvas.height)
        }
        if (uncopyableLeftWidth > 0) {
            painter(targetStart, uncopyableLeftWidth, 0, linesRepresentation, c)
        }
        if (uncopyableRightWidth > 0) {
            painter(targetEnd - uncopyableRightWidth, uncopyableRightWidth, canvas.width - uncopyableRightWidth - 1, linesRepresentation, c)
        }
    }
}

type OffscreenPainter = (startInclusive: number, width: number, pixelXOffset: number, data: TimeColumn[], c: CanvasRenderingContext2D) => void
export const useOffscreenPainter = (styles: string[], height: number, myPositions: number[]) => {
    const drawSlice = useCallback((column: TimeColumn, xPosition: number, c: CanvasRenderingContext2D) => {
        for (const [probability, runs] of column) {
            if (runs === undefined || runs.length === 0) continue
            c.strokeStyle = styles[probability]
            c.beginPath()
            for (const interval of runs) {
                if (interval.end === undefined) continue // this shouldn't happen
                const startPixel = myPositions[interval.start]
                const endPixel = myPositions[interval.end]
                c.moveTo(xPosition, height - startPixel)
                c.lineTo(xPosition, height - endPixel)
            }
            c.stroke()
        }
    }, [styles, height, myPositions])

    const clearRect = useCallback((width: number, pixelOffset: number, c: CanvasRenderingContext2D) => {
        c.fillStyle = styles[0]
        c.fillRect(pixelOffset, 0, width, height)
    }, [styles, height])

    const offscreenPainter = useCallback((startInclusive: number, width: number, pixelXOffset: number, data: TimeColumn[], c: CanvasRenderingContext2D) => {
        if (startInclusive + width >= data.length) {
            console.warn(`offscreenPainter called with end (${startInclusive + width} ${startInclusive} ${width}) outside the data range (${data.length}).`)
            return
        }
        clearRect(width, pixelXOffset, c)
        for (let i = startInclusive; i <= width + startInclusive; i++) {
            drawSlice(data[i], i - startInclusive + pixelXOffset, c)
        }
    }, [clearRect, drawSlice])

    return offscreenPainter
}


// TODO: Harmonize with other implementations of this
const getRenderTargetRange = (midpoint: number, dataWidth: number, canvasWidth: number) => {
    // if all the data fits on the canvas, no need to clip anything
    // (Remember canvas widths are NOT inclusive of 0, while the returned value here WILL be.)
    if (canvasWidth > dataWidth) return {targetStart: 0, targetEnd: dataWidth}
    const halfCanvasWidth = canvasWidth / 2
    if (midpoint <= halfCanvasWidth) {
        return {targetStart: 0, targetEnd: canvasWidth - 1}
    }
    if ((midpoint + halfCanvasWidth) > dataWidth) { // hard > b/c we used a floor
        return {targetStart: dataWidth - canvasWidth + 1, targetEnd: dataWidth}
    }
    // entire canvas width will not run out the data width; just return either side of the midpoint
    const targetStart = Math.ceil(midpoint - halfCanvasWidth)
    const targetEnd = Math.floor(midpoint + halfCanvasWidth) - 1
    return { targetStart, targetEnd }
}


export const getColorStyles = (map?: ValidColorMap) => {
    // Complement colors come from https://www.learnui.design/tools/accessible-color-generator.html
    // Complement for viridis 0 (#440154) and 255 (#fbe723) is #4AC4E2, though that's not a great contrast with the midrange
    // of that scale (around #228b8d) so maybe look for a different one?
    // Complement for magma 0 (#000004) and 255 (#fcfbbd) is #6d70a9
    // Complement for inferno 0 (#000004) and 255 (#fafda1) is #6667bd
    // Complement for plasma 0 (#0d0887) and 255 (#f0f724) is #3c90c0, but consider #40cdff or #4597c7
    // Complement for default (whose 0 is #00003c) is #7361ff
    const fn = (v: number | undefined): string => {
        if (v === undefined) return "rgba(0, 0, 0, 0)"
        // if (v === 0) return "#BBBAB8" // Uncomment for contrasting neutral (dove-grey) background.
        // Instead, map it to a dove-grey color that will hopefully provide decent contrast with the real color scales.
        const v_effective = Math.min(1, v/128)
        switch (map) {
            case 'inferno':
                return inferno(v_effective)
            case 'magma':
                return magma(v_effective)
            case 'plasma':
                return plasma(v_effective)
            case 'viridis':
                return viridis(v_effective)
            default:
                const proportion = (v)
                const intensity = Math.max(0, Math.min(255, 3 * Math.floor(proportion)))
                return `rgba(${intensity}, ${intensity}, 60, 255)`
        }
    }
    const styles = Array.from({length: 256}).map((v, i) => fn(i))
    const contrasts = {
        'viridis': '#4ac4e2',
        'magma': '#6d70a9',
        'inferno':  '#6667bd',
        'plasma': '#3c90c0'
    }
    return { colorStyles: styles, contrastStyle: map === undefined ? '#7361ff' : contrasts[map] }
}