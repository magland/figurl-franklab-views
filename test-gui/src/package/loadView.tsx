import { ViewComponentProps } from "@figurl/core-views"
import { FunctionComponent } from "react"
import DecodedLinearPositionPlotView from "./view-decoded-linear-position-plot/DecodedLinearPositionPlotView"
import { isDecodedLinearPositionPlotData } from "./view-decoded-linear-position-plot/DecodedLinearPositionPlotViewData"
import { isTrackAnimationStaticData, TrackPositionAnimationView } from "./view-track-position-animation"

const loadView = (o: {data: unknown, width: number, height: number, opts: unknown, ViewComponent: FunctionComponent<ViewComponentProps>}) => {
    const {data, width, height} = o
    if (isTrackAnimationStaticData(data)) {
        return <TrackPositionAnimationView data={data} width={width} height={height} />
    } else if (isDecodedLinearPositionPlotData(data)) {
        return <DecodedLinearPositionPlotView data={data} width={width} height={height} />
    }
    else return undefined
}

export default loadView