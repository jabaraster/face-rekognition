const { filter, CompareFaceResult } = require("../src/lib");

describe("filter", () => {
    it("should remove duplicate faces", () => {
        const src = [
            {
                source: {
                    photoFileDescriptor: "face0",
                    boundingBox: {
                        top: 0,
                        left: 0.00002,
                        width: 0.5,
                        height: 0.4,
                    },
                },
                target: {
                    photoFileDescriptor: "face0",
                    boundingBox: {
                        top: 0.00001,
                        left: 0,
                        width: 0.499998,
                        height: 0.4003,
                    },
                },
                similarity: 0,
            },
        ];
        expect(filter(src)).toEqual([]);
    });
});