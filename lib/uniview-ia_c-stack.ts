import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";

export class UniviewIaCStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 👇 create the VPC
    const vpc = new ec2.Vpc(this, "uniview-vpc", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: "public-subnet-1",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "isolated-subnet-1",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    // 👇 create a security group for the EC2 instance
    const ec2InstanceSG = new ec2.SecurityGroup(this, "uniview-instance-sg", {
      vpc,
    });

    ec2InstanceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "allow TCP connection on PORT 80 from anywhere(server port)"
    );
    ec2InstanceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5000),
      "allow TCP connection on PORT 4000 from anywhere(server port)"
    );

    // create EBS root volume
    const rootVolume: ec2.BlockDevice = {
      deviceName: "/dev/xvda", // Use the root device name
      volume: ec2.BlockDeviceVolume.ebs(30), // Override the volume size in Gibibytes (GiB)
    };
    // 👇 create the EC2 instance
    const ec2Instance = new ec2.Instance(this, "uniview-instance", {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: ec2InstanceSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: new ec2.GenericLinuxImage({
        // NOTE: AMI from uniview-backend-1
        "ap-northeast-2": "ami-0b588dcf47fa944ea",
      }),
      blockDevices: [rootVolume],
    });
    ec2Instance.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    // elastic IP
    const eip = new ec2.CfnEIP(this, "server-ip");
    // EC2 Instance <> EIP
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const eipAssociation = new ec2.CfnEIPAssociation(this, "Ec2Association", {
      eip: eip.ref,
      instanceId: ec2Instance.instanceId,
    });

    // 👇 create RDS instance
    const dbInstance = new rds.DatabaseInstanceFromSnapshot(
      this,
      "uniview-db-instance",
      {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_12,
        }),
        snapshotIdentifier:
          "arn:aws:rds:ap-northeast-2:598559636920:snapshot:uniview-db-snapshop-2023-10-28",
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE2,
          ec2.InstanceSize.MICRO
        ),
        allowMajorVersionUpgrade: false,
        autoMinorVersionUpgrade: true,
        deleteAutomatedBackups: true,
        publiclyAccessible: false,
        deletionProtection: false,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        backupRetention: cdk.Duration.days(0),
        allocatedStorage: 20,
        multiAz: false,
        credentials: rds.SnapshotCredentials.fromGeneratedSecret("postgres"),
      }
    );
    dbInstance.connections.allowFrom(ec2Instance, ec2.Port.tcp(5432));

    new cdk.CfnOutput(this, "dbEndpoint", {
      value: dbInstance.instanceEndpoint.hostname,
    });

    new cdk.CfnOutput(this, "secretName", {
      value: dbInstance.secret?.secretName as string,
    });
  }
}
