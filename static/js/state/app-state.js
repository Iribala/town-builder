const appState = {
    myName: '',
    selectedObject: null,
    drivingCar: null,
    pendingPlacementModelDetails: null
};

export function getMyName() {
    return appState.myName;
}

export function setMyName(name) {
    appState.myName = name || '';
}

export function getSelectedObject() {
    return appState.selectedObject;
}

export function setSelectedObject(object) {
    appState.selectedObject = object;
}

export function getDrivingCar() {
    return appState.drivingCar;
}

export function setDrivingCar(car) {
    appState.drivingCar = car;
}

export function getPendingPlacementModelDetails() {
    return appState.pendingPlacementModelDetails;
}

export function setPendingPlacementModelDetails(details) {
    appState.pendingPlacementModelDetails = details;
}

