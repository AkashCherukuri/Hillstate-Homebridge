// This file defines all enums and types to be used for elegant API calls in hillstate.ts

export interface deviceDiscoverResp {
    'resultStatus': string
    'transactionId': string
    'data': {
        'totalCount': number
        'deviceList': Array<{
            'id': string
            'deviceType': string
            'deviceName': string
            'deviceLocation': string
            'state': string
            'deviceDetailName': string | undefined
            'statusList': Array<{
                'command': string
                'value': string
            }>
        }>
    }
}

export type OnOrOff = 
    | 'on'
    | 'off'

export type AirConWind = 
    | 'light'
    | 'mid'
    | 'pow'

export type AirConMode = 
    | 'auto'
    | 'cool'
    | 'dehumidify'
    | 'airwash'

export interface deviceStatusCommand {
    'command': string
    'value': string
}

export interface deviceStatusResp {
    'resultStatus': string
    'transactionId': string
    'data': {
        'deviceType': string,
        'statusList': Array<deviceStatusCommand>
        'deviceDetailName': string | undefined
        'id': string
        'state': string
    }
}
