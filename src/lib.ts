import {
    RekognitionClient,
    CompareFacesCommand,
    DetectFacesCommand,
    BoundingBox as AWSBoundingBox,
} from "@aws-sdk/client-rekognition";
import { v4 as uuid } from "uuid";
import Jimp from "jimp";
import { setTimeout } from "timers/promises";

const rekognition = new RekognitionClient({
    region: "ap-northeast-1",
});

type FileDescriptor = string;
type PersonalDescriptor = string;

interface BoundingBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface FaceInPhoto {
    photoFileDescriptor: FileDescriptor;
    boundingBox: BoundingBox;
    confidence?: number;
}

export interface PersonallyIdentifiedFaceInPhoto extends FaceInPhoto {
    personalDescriptor: PersonalDescriptor;
}

export async function extractPersonallyIdentifiedFaces(
    fileDescriptors: FileDescriptor[],
    loader: (fileDescriptor: FileDescriptor) => Promise<Buffer>,
): Promise<PersonallyIdentifiedFaceInPhoto[]> {
    const faces = await extractFaces(fileDescriptors, loader);
    const comparision = await compareFaces(faces, loader);
    const filtered = filter(comparision);
    return identifyPersonally(faces, filtered);
}

export async function extractFaces(
    fileDescriptors: FileDescriptor[],
    loader: (fileDescriptor: FileDescriptor) => Promise<Buffer>,
): Promise<FaceInPhoto[]> {
    const counter = getCounter();
    const ps = await Promise.all(
        fileDescriptors.map(async (fileDescriptor) => {
            const cnt = counter();
            await setTimeout(200 * cnt);
            console.log(`start extract faces: cnt: ${cnt} fileDescriptor: ${fileDescriptor}`);
            const ps = await rekognition.send(
                new DetectFacesCommand({
                    Image: { Bytes: await loader(fileDescriptor) },
                }),
            );
            return ps.FaceDetails!.map((faceDetail) => {
                return {
                    photoFileDescriptor: fileDescriptor,
                    boundingBox: b2b(faceDetail.BoundingBox!),
                    confidence: faceDetail!.Confidence,
                };
            });
        }),
    );
    return ps.flat();
}

export function identifyPersonally(
    faces: FaceInPhoto[],
    comparision: CompareFaceResult[],
): PersonallyIdentifiedFaceInPhoto[] {
    const ret: PersonallyIdentifiedFaceInPhoto[] = faces.map((face) => {
        return {
            photoFileDescriptor: face.photoFileDescriptor,
            boundingBox: face.boundingBox,
            personalDescriptor: "",
        };
    });
    ret.forEach((face) => {
        const desc = face.personalDescriptor === "" ? uuid() : face.personalDescriptor;
        if (face.personalDescriptor === "") face.personalDescriptor = desc;
        const samePersons = comparision.filter(
            (c) => (equalsFaces(face, c.source) || equalsFaces(face, c.target)) && c.similarity > 0.9,
        );
        samePersons.forEach((sp) => {
            const sourcePerson = ret.find((f) => equalsFaces(f, sp.source));
            if (sourcePerson) sourcePerson.personalDescriptor = desc;

            const targetPerson = ret.find((f) => equalsFaces(f, sp.target));
            if (targetPerson) targetPerson.personalDescriptor = desc;
        });
    });
    return ret;
}

export interface CompareFaceResult {
    source: FaceInPhoto;
    target: FaceInPhoto;
    similarity: number;
}

// 呼び出すたびに1増えた数を返す関数を返す
function getCounter(): () => number {
    let cnt = 0;
    return () => {
        return cnt++;
    };
}

export async function compareFaces(
    faces: FaceInPhoto[],
    loader: (fileDescriptor: FileDescriptor) => Promise<Buffer>,
): Promise<CompareFaceResult[]> {
    const fileDescriptors = Array.from(new Set(faces.map((face) => face.photoFileDescriptor)));
    const bufs: Map<FileDescriptor, Buffer> = await toBuffers(fileDescriptors, loader);
    const counter = getCounter();
    return (await Promise.all(faces.map((face) => compareFace(face, fileDescriptors, bufs, counter)))).flat();
}

export async function compareFace(
    face: FaceInPhoto,
    fileDescriptors: FileDescriptor[],
    buffers: Map<FileDescriptor, Buffer>,
    counter: () => number,
): Promise<CompareFaceResult[]> {
    const ary = await Promise.all(
        fileDescriptors.map(async (fileDescriptor) => {
            const cnt = counter();
            await setTimeout(200 * cnt);
            console.log(
                `start compare: cnt: ${cnt} face: ${face.photoFileDescriptor} fileDescriptor: ${fileDescriptor}`,
            );
            const faceImg = await faceImage(face, buffers);
            const faceImgData = await new Promise<Buffer>((resolve, reject) => {
                faceImg.getBuffer(Jimp.MIME_JPEG, async (err, buffer) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(buffer);
                    }
                });
            });
            try {
                const ret = await rekognition.send(
                    new CompareFacesCommand({
                        SourceImage: { Bytes: faceImgData },
                        TargetImage: { Bytes: buffers.get(fileDescriptor)! },
                    }),
                );
                const ary0: CompareFaceResult[] = ret.FaceMatches!.map((faceMatch) => {
                    return {
                        source: face,
                        target: {
                            photoFileDescriptor: fileDescriptor,
                            boundingBox: b2b(faceMatch.Face!.BoundingBox!),
                            confidence: faceMatch.Face!.Confidence!,
                        },
                        similarity: faceMatch.Similarity!,
                    };
                });
                const ary1: CompareFaceResult[] = ret.UnmatchedFaces!.map((unmatchedFace) => {
                    return {
                        source: face,
                        target: {
                            photoFileDescriptor: fileDescriptor,
                            boundingBox: b2b(unmatchedFace.BoundingBox!),
                            confidence: unmatchedFace.Confidence!,
                        },
                        similarity: 0,
                    };
                });
                return ary0.concat(ary1);
            } catch (e) {
                console.error(e);
                return [];
            }
        }),
    );
    return ary.flat();
}

function filter(src: CompareFaceResult[]): CompareFaceResult[] {
    return src.filter((face, i) => {
        if (equalsFaces(face.source, face.target)) return false;
        const rvc = src.slice(i + 1).find((face2: any) => {
            return equalsFaces(face.source, face2.target) && equalsFaces(face.target, face2.source);
        });
        return !rvc;
    });
}

function b2b(b: AWSBoundingBox): BoundingBox {
    return {
        left: b.Left!,
        top: b.Top!,
        width: b.Width!,
        height: b.Height!,
    };
}

async function faceImage(face: FaceInPhoto, buffers: Map<FileDescriptor, Buffer>): Promise<Jimp> {
    const srcImg = await Jimp.read(buffers.get(face.photoFileDescriptor)!);
    const ret = srcImg.crop(
        srcImg.getWidth() * face.boundingBox.left,
        srcImg.getHeight() * face.boundingBox.top,
        srcImg.getWidth() * face.boundingBox.width,
        srcImg.getHeight() * face.boundingBox.height,
    );
    ret.write(
        `./log/${face.photoFileDescriptor}_${face.boundingBox.left}_${face.boundingBox.top}_${face.boundingBox.width}_${face.boundingBox.height}.jpg`,
    );
    return ret;
}

async function toBuffers(
    fileDescriptors: string[],
    loader: (fileDescriptor: FileDescriptor) => Promise<Buffer>,
): Promise<Map<FileDescriptor, Buffer>> {
    return (
        await Promise.all(
            fileDescriptors.map(async (fileDescriptor) => {
                return {
                    fileDescriptor,
                    buffer: await loader(fileDescriptor),
                };
            }),
        )
    ).reduce((acc, cur) => {
        acc.set(cur.fileDescriptor, cur.buffer);
        return acc;
    }, new Map<FileDescriptor, Buffer>());
}

function equalsFaces(lf: FaceInPhoto, rf: FaceInPhoto): boolean {
    if (lf.photoFileDescriptor !== rf.photoFileDescriptor) return false;
    if (lf.boundingBox.height < rf.boundingBox.height) {
        if (lf.boundingBox.height / rf.boundingBox.height < 0.98) {
            return false;
        }
    } else {
        if (rf.boundingBox.height / lf.boundingBox.height < 0.98) {
            return false;
        }
    }
    // 幅も同様
    if (lf.boundingBox.width < rf.boundingBox.width) {
        if (lf.boundingBox.width / rf.boundingBox.width < 0.98) {
            return false;
        }
    } else {
        if (rf.boundingBox.width / lf.boundingBox.width < 0.98) {
            return false;
        }
    }
    // Topのずれが高さの2/100を超えたら同じ顔ではない
    if (Math.abs(lf.boundingBox.top - rf.boundingBox.top) > lf.boundingBox.height * 0.02) {
        return false;
    }
    // Leftも同様
    if (Math.abs(lf.boundingBox.left - rf.boundingBox.left) > lf.boundingBox.width * 0.02) {
        return false;
    }
    return true;
}
