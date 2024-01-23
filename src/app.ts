import dotenv from "dotenv";
import * as lib from "./lib";
import { CompareFaceResult } from "./lib";
import * as fs from "fs/promises";

dotenv.config();

(async () => {
    const paths = (await fs.readdir("./test-image")).filter(
        (path) => path.endsWith(".jpg") || path.endsWith(".png") || path.endsWith(".jpeg"),
    );
    const loader = async (path: string) => {
        return await fs.readFile(`./test-image/${path}`);
    };
    const ret = await lib.extractPersonallyIdentifiedFaces(paths, loader);
    ret.sort((a, b) => {
        return a.personalDescriptor.localeCompare(b.personalDescriptor);
    });
    fs.writeFile(`log/${new Date().getTime()}.json`, JSON.stringify(ret, null, 2));
    ret.forEach((r) => {
        console.log("<div>");
        console.log(
            `  <img src="${r.photoFileDescriptor}" style="object-view-box: inset(${r.boundingBox.top * 100}% ${100 - (r.boundingBox.left + r.boundingBox.width) * 100}% ${100 - (r.boundingBox.top + r.boundingBox.height) * 100}% ${r.boundingBox.left * 100}%)">`,
        );
        console.log(`  <span>${r.personalDescriptor}</span>`);
        console.log("</div>");
    });
})();
