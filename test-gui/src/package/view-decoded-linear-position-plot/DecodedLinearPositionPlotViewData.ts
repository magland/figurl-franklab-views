import { isArrayOf, isEqualTo, isNumber, optional, validateObject } from "@figurl/core-utils";

export type DecodedLinearPositionPlotData = {
    type: 'Decoded1dPositionData'
    values: number[]
    positions: number[]
    frameBounds: number[]
    positionsKey: number[]
    startTimeSec?: number
    samplingFrequencyHz?: number // TODO: Can we get rid of this?
}

export const isDecodedLinearPositionPlotData = (x: any) : x is DecodedLinearPositionPlotData => {
    return validateObject(x, {
        type: isEqualTo('DecodedLinearPositionData'),
        values: isArrayOf(isNumber),
        positions: isArrayOf(isNumber),
        frameBounds: isArrayOf(isNumber),
        positionsKey: isArrayOf(isNumber),
        startTimeSec: optional(isNumber),
        samplingFrequencyHz: optional(isNumber)
        // start time seconds?
    })
}
